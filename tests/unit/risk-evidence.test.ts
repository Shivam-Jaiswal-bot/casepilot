import { describe, expect, it } from "vitest";
import type { ValidatableSource } from "@/server/rag/citations";
import { findQuoteOffset, matchQuote, verifyClauseEvidence, verifyFindings } from "@/server/risk/evidence";
import { categoryEvaluationSchema, type CategoryEvaluation, type FindingOutput } from "@/server/risk/schema";

const sources: ValidatableSource[] = [
  {
    id: "S1",
    chunkId: "chunk-term",
    documentId: "d1",
    documentTitle: "MSA",
    pageStart: 2,
    pageEnd: 2,
    sectionTitle: "3.2 Termination for Convenience",
    content: "The Provider may terminate this Agreement for any reason on ten (10) days written notice. The Customer may terminate for convenience only on one hundred eighty (180) days written notice.",
  },
];

const finding = (overrides: Partial<FindingOutput> = {}): FindingOutput => ({
  title: "Asymmetric termination for convenience",
  severityFactors: { direction: "ADVERSE", exposure: "SIGNIFICANT", marketPosition: "DEVIATES" },
  severity: "HIGH",
  explanation: "Provider can exit on 10 days; Customer needs 180.",
  basis: "EXPLICIT",
  evidence: [{ sourceId: "S1", quote: "The Provider may terminate this Agreement for any reason on ten (10) days written notice" }],
  businessImplication: "Service could stop with little warning.",
  reviewSuggestion: "Negotiate mutual notice periods.",
  confidence: "HIGH",
  ...overrides,
});

const evaluation = (findings: FindingOutput[], clauseStatus: CategoryEvaluation["clauseStatus"] = "PRESENT"): CategoryEvaluation => ({
  clauseStatus,
  summary: "summary",
  clauseEvidence: [],
  findings,
});

describe("matchQuote", () => {
  it("matches verbatim quotes regardless of whitespace, case and typographic quotes", () => {
    expect(matchQuote("the provider may  TERMINATE this agreement for any reason", sources[0].content)).toBe("EXACT");
  });

  it("accepts near-verbatim quotes (minor elision) as NEAR", () => {
    expect(
      matchQuote("The Customer may terminate for convenience only on one hundred eighty (180) days notice", sources[0].content),
    ).toBe("NEAR");
  });

  it("rejects fabricated wording", () => {
    expect(matchQuote("The Provider shall pay liquidated damages of $1,000,000", sources[0].content)).toBeNull();
    expect(matchQuote("ten", sources[0].content)).toBeNull(); // too short to be meaningful evidence
  });
});

describe("verifyFindings", () => {
  it("keeps findings with verified evidence and attaches source location", () => {
    const { findings, discarded } = verifyFindings(evaluation([finding()]), sources);
    expect(discarded).toBe(0);
    expect(findings[0].evidence[0]).toMatchObject({ chunkId: "chunk-term", pageStart: 2, sectionTitle: "3.2 Termination for Convenience", match: "EXACT" });
  });

  it("discards findings citing unknown sources or unverifiable quotes", () => {
    const { findings, discarded } = verifyFindings(
      evaluation([
        finding({ evidence: [{ sourceId: "S9", quote: "The Provider may terminate this Agreement for any reason" }] }),
        finding({ evidence: [{ sourceId: "S1", quote: "Customer must indemnify Provider for all losses whatsoever" }] }),
        finding({ evidence: [] }),
      ]),
      sources,
    );
    expect(findings).toHaveLength(0);
    expect(discarded).toBe(3);
  });

  it("drops only the unverifiable evidence item when another one verifies", () => {
    const { findings } = verifyFindings(
      evaluation([
        finding({
          evidence: [
            { sourceId: "S1", quote: "invented clause text that is not present anywhere" },
            { sourceId: "s1", quote: "The Customer may terminate for convenience only on one hundred eighty (180) days written notice" },
          ],
        }),
      ]),
      sources,
    );
    expect(findings[0].evidence).toHaveLength(1);
  });

  it("caps findings per category and counts the overflow as discarded", () => {
    const { findings, discarded } = verifyFindings(evaluation(Array.from({ length: 7 }, () => finding())), sources);
    expect(findings).toHaveLength(5);
    expect(discarded).toBe(2);
  });

  it("produces no findings for a NOT_IDENTIFIED category", () => {
    expect(verifyFindings(evaluation([], "NOT_IDENTIFIED"), sources)).toEqual({ findings: [], discarded: 0 });
  });
});

describe("evidence location", () => {
  const multi: ValidatableSource = {
    ...sources[0],
    id: "S2",
    chunkId: "chunk-multi",
    pageStart: 1,
    pageEnd: 2,
    sectionTitle: "1. Fees … 3. Termination",
    content: "1. Fees\n\nInvoices are due in 15 days.\n\n3. Termination\n\nEither party may terminate on 30 days notice.",
    spans: [
      { offset: 0, page: 1, section: "1. Fees" },
      { offset: 39, page: 2, section: "3. Termination" },
    ],
  };

  it("pins evidence to the page and section where the quote sits, not the whole chunk range", () => {
    expect(findQuoteOffset("Either party may terminate on 30 days notice", multi.content)).toBe(multi.content.indexOf("Either"));
    const [ev] = verifyClauseEvidence([{ sourceId: "S2", quote: "Either party may terminate on 30 days notice" }], [multi]);
    expect(ev).toMatchObject({ pageStart: 2, pageEnd: 2, sectionTitle: "3. Termination", match: "EXACT" });
  });

  it("falls back to the chunk's location when the quote cannot be pinned (no spans)", () => {
    const [ev] = verifyClauseEvidence([{ sourceId: "S1", quote: "The Provider may terminate this Agreement for any reason" }], sources);
    expect(ev).toMatchObject({ pageStart: 2, sectionTitle: "3.2 Termination for Convenience" });
  });

  it("rejects clause evidence that does not appear in the cited source", () => {
    expect(verifyClauseEvidence([{ sourceId: "S2", quote: "The Customer shall indemnify the Provider" }], [multi])).toEqual([]);
  });
});

describe("structured output schema", () => {
  it("accepts a well-formed evaluation", () => {
    expect(categoryEvaluationSchema.safeParse(evaluation([finding()])).success).toBe(true);
  });

  it("rejects unknown severities and missing required fields", () => {
    expect(categoryEvaluationSchema.safeParse(evaluation([finding({ severity: "SEVERE" as never })])).success).toBe(false);
    const { reviewSuggestion: _r, ...incomplete } = finding();
    expect(categoryEvaluationSchema.safeParse({ clauseStatus: "PRESENT", summary: "", clauseEvidence: [], findings: [incomplete] }).success).toBe(false);
  });
});
