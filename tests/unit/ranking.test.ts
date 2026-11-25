import { describe, expect, it } from "vitest";
import {
  dedupeCandidates,
  overlapCoefficient,
  reciprocalRankFusion,
  selectWithinBudget,
  toOrTsQuery,
  type Candidate,
} from "@/server/retrieval/ranking";

const cand = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  chunkId: id,
  documentId: "doc-1",
  documentTitle: "Doc",
  chunkIndex: Number(id.replace(/\D/g, "")) || 0,
  pageStart: 1,
  pageEnd: 1,
  sectionTitle: null,
  content: `content of ${id} with several distinct words ${id}`,
  tokenCount: 100,
  ...extra,
});

describe("reciprocalRankFusion", () => {
  it("rewards items that rank well in both lists", () => {
    const fused = reciprocalRankFusion([
      { kind: "vector", items: [cand("a"), cand("b"), cand("c")] },
      { kind: "text", items: [cand("c"), cand("b"), cand("d")] },
    ]);
    // c: 1/63 + 1/61 ≈ 0.03227, b: 2/62 ≈ 0.03226 — both outrank single-list items a and d.
    expect(fused.map((f) => f.chunkId)).toEqual(["c", "b", "a", "d"]);
    const b = fused.find((f) => f.chunkId === "b")!;
    expect(b.score).toBeCloseTo(2 / 62, 6);
    expect(b).toMatchObject({ vectorRank: 2, textRank: 2 });
    expect(fused.find((f) => f.chunkId === "d")).toMatchObject({ vectorRank: null, textRank: 3 });
  });

  it("returns an empty list for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

describe("dedupeCandidates", () => {
  it("drops chunks that mostly repeat a higher-ranked chunk of the same document", () => {
    const base = "the provider may terminate this agreement for any reason on ten days written notice to the customer";
    const ranked = [cand("1", { content: base }), cand("2", { content: `${base} and more` }), cand("3", { content: "entirely different governing law text about delaware courts and venue" })];
    expect(dedupeCandidates(ranked).map((c) => c.chunkId)).toEqual(["1", "3"]);
  });

  it("keeps identical text from different documents (multi-document retrieval)", () => {
    const text = "standard confidentiality obligations apply to both parties for five years after termination";
    const ranked = [cand("1", { content: text }), cand("2", { content: text, documentId: "doc-2" })];
    expect(dedupeCandidates(ranked)).toHaveLength(2);
  });

  it("computes overlap as |A∩B| / min(|A|,|B|)", () => {
    expect(overlapCoefficient("a b c d e f", "a b c d e f")).toBe(1);
    expect(overlapCoefficient("a b c d e f", "z y x w v u")).toBe(0);
  });
});

describe("selectWithinBudget", () => {
  it("respects both topK and the token budget, skipping items that do not fit", () => {
    const ranked = [cand("1", { tokenCount: 400 }), cand("2", { tokenCount: 700 }), cand("3", { tokenCount: 300 }), cand("4", { tokenCount: 100 })];
    expect(selectWithinBudget(ranked, 10, 1000).map((c) => c.chunkId)).toEqual(["1", "3", "4"]);
    expect(selectWithinBudget(ranked, 2, 10_000).map((c) => c.chunkId)).toEqual(["1", "2"]);
  });
});

describe("toOrTsQuery", () => {
  it("builds an OR query of content terms, dropping stopwords and punctuation", () => {
    expect(toOrTsQuery("Can the other party terminate this agreement without notice?")).toBe("other | party | terminate | without | notice");
  });

  it("returns null when nothing searchable remains (and never passes operators through)", () => {
    expect(toOrTsQuery("& | ! ( )")).toBeNull();
    expect(toOrTsQuery("a an of")).toBeNull();
  });
});
