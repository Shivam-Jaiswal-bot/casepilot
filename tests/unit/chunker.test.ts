import { describe, expect, it } from "vitest";
import { chunkBlocks, embeddingInput, estimateTokens, locateInChunk, splitSentences } from "@/server/chunking/chunker";
import { buildStructuredBlocks, extractDocument } from "@/server/extraction";
import type { StructuredBlock } from "@/server/extraction/types";
import { buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";

const opts = { targetTokens: 120, maxTokens: 200, overlapTokens: 25 };

const block = (text: string, extra: Partial<StructuredBlock> = {}): StructuredBlock => ({
  text,
  pageNumber: 1,
  segmentIndex: 0,
  sectionTitle: "1. Scope",
  isHeading: false,
  ...extra,
});

describe("chunkBlocks", () => {
  it("produces chunks within the token limits with contiguous indexes", async () => {
    const ex = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    const chunks = chunkBlocks(buildStructuredBlocks(ex.segments), opts);
    expect(chunks.length).toBeGreaterThan(2);
    chunks.forEach((c, i) => {
      expect(c.chunkIndex).toBe(i);
      expect(c.tokenCount).toBeLessThanOrEqual(opts.maxTokens);
      expect(c.content.trim()).not.toBe("");
    });
  });

  it("preserves page and section metadata on every chunk", async () => {
    const ex = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    const chunks = chunkBlocks(buildStructuredBlocks(ex.segments), opts);
    const liability = chunks.find((c) => c.content.includes("total aggregate liability"));
    expect(liability).toMatchObject({ pageStart: 3, pageEnd: 3 });
    expect(liability?.sectionTitle).toContain("Limitation of Liability");
    for (const c of chunks) {
      expect(c.pageStart).not.toBeNull();
      expect(c.pageEnd! >= c.pageStart!).toBe(true);
    }
  });

  it("never ends a chunk on a dangling heading", async () => {
    const ex = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    const blocks = buildStructuredBlocks(ex.segments);
    const headings = new Set(blocks.filter((b) => b.isHeading).map((b) => b.text));
    const chunks = chunkBlocks(blocks, opts);
    for (const c of chunks.slice(0, -1)) {
      const lastParagraph = c.content.split("\n\n").at(-1)!;
      expect(headings.has(lastParagraph)).toBe(false);
    }
  });

  it("labels chunks spanning several sub-clauses with all of them", () => {
    const blocks = [
      block("3. Term", { isHeading: true, sectionTitle: "3. Term" }),
      block("3.2 Convenience", { isHeading: true, sectionTitle: "3. Term › 3.2 Convenience" }),
      block("Either party may terminate on notice.", { sectionTitle: "3. Term › 3.2 Convenience" }),
      block("3.3 Cause", { isHeading: true, sectionTitle: "3. Term › 3.3 Cause" }),
      block("Either party may terminate for breach.", { sectionTitle: "3. Term › 3.3 Cause" }),
    ];
    const [chunk] = chunkBlocks(blocks, opts);
    expect(chunk.sectionTitle).toBe("3. Term › 3.2 Convenience; 3.3 Cause");
  });

  it("splits over-long paragraphs at sentence boundaries and carries overlap within a section", () => {
    const sentence = (i: number) => `Clause sentence number ${i} imposes an obligation on the supplier to perform the services diligently.`;
    const long = Array.from({ length: 30 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkBlocks([block(long)], opts);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.tokenCount <= opts.maxTokens)).toBe(true);
    // Every chunk after the first starts with overlap from its predecessor.
    expect(chunks.slice(1).every((c) => c.metadata.overlapTokens > 0)).toBe(true);
    const lastSentenceOfFirst = splitSentences(chunks[0].content).at(-1)!;
    expect(chunks[1].content.startsWith(lastSentenceOfFirst)).toBe(true);
  });

  it("does not carry overlap across a section boundary", () => {
    const para = "The supplier shall deliver the goods in accordance with the specification and the delivery schedule. ".repeat(4);
    const blocks = [
      block("1. Delivery", { isHeading: true, sectionTitle: "1. Delivery" }),
      block(para, { sectionTitle: "1. Delivery" }),
      block("2. Acceptance", { isHeading: true, sectionTitle: "2. Acceptance" }),
      block(para.replace(/deliver/g, "accept"), { sectionTitle: "2. Acceptance" }),
    ];
    const chunks = chunkBlocks(blocks, opts);
    const acceptance = chunks.find((c) => c.content.startsWith("2. Acceptance"));
    expect(acceptance?.metadata.overlapTokens).toBe(0);
  });

  it("records offset spans that map back to each paragraph's page and section", async () => {
    const ex = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    const chunks = chunkBlocks(buildStructuredBlocks(ex.segments), { targetTokens: 450, maxTokens: 700, overlapTokens: 60 });
    const withTermination = chunks.find((c) => c.content.includes("for any reason on ten (10) days"))!;
    const offset = withTermination.content.indexOf("The Provider may terminate");
    expect(locateInChunk(withTermination.metadata.spans, offset)).toMatchObject({
      page: 2,
      section: "3. Term and Termination › 3.2 Termination for Convenience",
    });
    expect(locateInChunk(withTermination.metadata.spans, 0)?.offset).toBe(0);
  });

  it("is deterministic", async () => {
    const ex = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    const blocks = buildStructuredBlocks(ex.segments);
    expect(chunkBlocks(blocks, opts)).toEqual(chunkBlocks(blocks, opts));
  });
});

describe("helpers", () => {
  it("keeps legal abbreviations inside sentences", () => {
    expect(splitSentences("See Sec. 4 of the Agreement. The U.S. entity pays.")).toEqual([
      "See Sec. 4 of the Agreement.",
      "The U.S. entity pays.",
    ]);
  });

  it("estimates tokens at ~4 chars/token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("prefixes embedding input with document and section context but leaves content verbatim", () => {
    const input = embeddingInput({ content: "Body text.", sectionTitle: "9. Liability" }, "Acme MSA");
    expect(input).toBe("Document: Acme MSA\nSection: 9. Liability\n\nBody text.");
  });
});
