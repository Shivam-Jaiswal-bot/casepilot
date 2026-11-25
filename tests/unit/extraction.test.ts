import { describe, expect, it } from "vitest";
import { PipelineError } from "@/server/errors";
import { buildStructuredBlocks, extractDocument } from "@/server/extraction";
import { htmlToBlocks } from "@/server/extraction/docx";
import { linesToParagraphs } from "@/server/extraction/normalize";
import { detectHeading } from "@/server/extraction/sections";
import { buildDocx, buildImageOnlyPdf, buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";

describe("PDF extraction", () => {
  it("preserves page boundaries and paragraph structure", async () => {
    const result = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    expect(result.pageCount).toBe(3);
    expect(result.segments.map((s) => s.pageNumber)).toEqual([1, 2, 3]);
    // Wrapped lines are re-joined into one paragraph.
    const page2 = result.segments[1].blocks.map((b) => b.text);
    expect(page2.some((t) => t.startsWith("3.2 Termination for Convenience.") && t.includes("ten (10) days written notice"))).toBe(true);
  });

  it("attaches the correct page and section to each structured block", async () => {
    const result = await extractDocument("pdf", await buildPdf(SAMPLE_CONTRACT_PAGES));
    const blocks = buildStructuredBlocks(result.segments);
    const convenience = blocks.find((b) => !b.isHeading && b.text.startsWith("The Provider may terminate"));
    expect(convenience).toMatchObject({ pageNumber: 2, sectionTitle: "3. Term and Termination › 3.2 Termination for Convenience" });
    const liability = blocks.find((b) => b.text.includes("total aggregate liability"));
    expect(liability).toMatchObject({ pageNumber: 3, sectionTitle: "4. Limitation of Liability" });
  });

  it("fails permanently (non-retryable) on image-only PDFs", async () => {
    await expect(extractDocument("pdf", await buildImageOnlyPdf())).rejects.toMatchObject({ code: "PDF_NO_TEXT", retryable: false });
  });

  it("fails permanently on corrupt PDFs", async () => {
    const corrupt = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("garbage".repeat(50))]);
    const err = await extractDocument("pdf", corrupt).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PipelineError);
    expect((err as PipelineError).retryable).toBe(false);
  });
});

describe("DOCX extraction", () => {
  it("uses Word heading styles to form sections", async () => {
    const data = await buildDocx("Supply Agreement", [
      { heading: "Termination", paragraphs: ["Either party may terminate on 30 days notice.", "Termination does not affect accrued rights."] },
      { heading: "Payment", paragraphs: ["Invoices are payable within 45 days."] },
    ]);
    const result = await extractDocument("docx", data);
    expect(result.pageCount).toBeNull();
    const blocks = buildStructuredBlocks(result.segments);
    expect(blocks.find((b) => b.text.startsWith("Invoices"))).toMatchObject({ sectionTitle: "Payment", pageNumber: null });
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects an empty document", async () => {
    await expect(extractDocument("docx", await buildDocx("", []))).rejects.toMatchObject({ code: "DOCX_NO_TEXT" });
  });

  it("parses mammoth HTML including entities, lists and tables", () => {
    const blocks = htmlToBlocks("<h2>Fees &amp; Payment</h2><p>Pay &#8364;100</p><ul><li>One</li></ul><table><tr><td><p>Cell</p></td></tr></table>");
    expect(blocks).toEqual([{ text: "Fees & Payment", headingLevel: 2 }, { text: "Pay €100" }, { text: "One" }, { text: "Cell" }]);
  });
});

describe("normalisation and heading detection", () => {
  it("removes page furniture, de-hyphenates and keeps numbered clauses separate", () => {
    const raw = "Page 3 of 10\nThe Supplier shall indem-\nnify the Customer against all\nclaims.\n(a) first item\n(b) second item\n3";
    expect(linesToParagraphs(raw)).toEqual(["The Supplier shall indemnify the Customer against all claims.", "(a) first item", "(b) second item"]);
  });

  it("detects article, numbered, inline and all-caps headings", () => {
    expect(detectHeading("ARTICLE IV - INDEMNIFICATION")).toMatchObject({ level: 1 });
    expect(detectHeading("12.2 Termination for Cause")).toMatchObject({ level: 2, title: "12.2 Termination for Cause" });
    expect(detectHeading("7.1 Fees. The Customer shall pay")).toMatchObject({ level: 2, title: "7.1 Fees", remainder: "The Customer shall pay" });
    expect(detectHeading("LIMITATION OF LIABILITY")).toMatchObject({ level: 1 });
    expect(detectHeading("The Customer shall pay all invoices.")).toBeNull();
  });
});
