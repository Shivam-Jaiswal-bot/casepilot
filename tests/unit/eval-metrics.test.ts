import { describe, expect, it } from "vitest";
import { loadDataset } from "../../scripts/eval/dataset";
import {
  clauseIdentification,
  costUsd,
  coversAllPhrases,
  evidenceCovers,
  isAnswerCorrect,
  isDecline,
  isStable,
  maxSeverity,
  numericGrounding,
  percentile,
  recallAtKs,
  severityBias,
  severityDistance,
  severityInBand,
} from "../../scripts/eval/metrics";
import { bySplit, summarizeAnswers, summarizeRisk } from "../../scripts/eval/summary";
import type { AnswerRow } from "../../scripts/eval/answers";
import type { RiskRunRow } from "../../scripts/eval/risk";
import { normalizeForMatch } from "@/server/risk/evidence";
import { splitCitedSentences } from "@/server/rag/citations";

const q = (extra: Partial<Parameters<typeof isAnswerCorrect>[0]> = {}) => ({ id: "q", question: "?", answerable: true, answerKeys: ["15", "fifteen"], ...extra });

describe("answer correctness", () => {
  it("requires an answer key for answerable questions and rejects abstentions", () => {
    expect(isAnswerCorrect(q(), "The Provider may terminate on fifteen (15) days notice [S1].", false)).toBe(true);
    expect(isAnswerCorrect(q(), "The Provider may terminate on thirty days notice.", false)).toBe(false);
    expect(isAnswerCorrect(q(), "fifteen", true)).toBe(false);
  });

  it("requires every answer-key group to match (conflict questions need both sides)", () => {
    const conflict = q({ answerKeys: undefined, answerKeyGroups: [["30", "thirty"], ["90", "ninety"]] });
    expect(isAnswerCorrect(conflict, "Section 14.4 allows 30 days [S1], but Section 7.5 says ninety (90) days [S2].", false)).toBe(true);
    expect(isAnswerCorrect(conflict, "The Customer has thirty (30) days to export [S1].", false)).toBe(false);
    expect(isAnswerCorrect(q({ answerKeys: undefined }), "anything", false)).toBe(false); // no keys = cannot be scored correct
  });

  it("recognises declines phrased as 'No X is identified / was found'", () => {
    expect(isDecline("No arbitration institution is identified in the retrieved excerpts.", false)).toBe(true);
    expect(isDecline("The retrieved excerpts do not identify an arbitration institution.", false)).toBe(true);
    expect(isDecline("No specific penalty for missing an implementation milestone was found in the retrieved content.", false)).toBe(true);
    expect(isDecline("No later than 30 days after notice, the Provider may suspend [S1].", false)).toBe(false);
  });

  it("normalises the multiplication sign and markdown emphasis in answer keys", () => {
    expect(isAnswerCorrect(q({ answerKeys: ["2x"] }), "capped at **2× the Fees** [S2]", false)).toBe(true);
    expect(isAnswerCorrect(q({ answerKeys: ["ten (10) days"] }), "after **ten (10) days** [S1]", false)).toBe(true);
  });

  it("recognises declines phrased as 'does not provide'", () => {
    expect(isDecline("The agreement does not provide for arbitration; disputes go to the Delaware courts [S1].", false)).toBe(true);
  });

  it("requires a decline for unanswerable questions", () => {
    const u = q({ answerable: false, answerKeys: undefined });
    expect(isAnswerCorrect(u, "The retrieved excerpts do not contain a service level provision.", false)).toBe(true);
    expect(isAnswerCorrect(u, "Service credits are 10% of monthly fees.", false)).toBe(false);
    expect(isDecline("anything", true)).toBe(true);
  });
});

describe("severity scoring", () => {
  it("takes the most severe finding and checks it against the band", () => {
    expect(maxSeverity(["LOW", "HIGH", "MEDIUM"])).toBe("HIGH");
    expect(maxSeverity([])).toBeNull();
    expect(severityInBand("HIGH", ["HIGH", "CRITICAL"])).toBe(true);
    expect(severityInBand("MEDIUM", ["HIGH", "CRITICAL"])).toBe(false);
    expect(severityInBand("LOW", ["MEDIUM", "LOW"])).toBe(true); // band order does not matter
  });

  it("treats 'no findings' as in-band only when INFORMATIONAL is acceptable", () => {
    expect(severityInBand(null, ["INFORMATIONAL", "LOW"])).toBe(true);
    expect(severityInBand(null, ["HIGH", "CRITICAL"])).toBe(false);
  });
});

describe("severity distance, bias and stability", () => {
  it("measures how far and in which direction a severity misses its band", () => {
    expect(severityDistance("HIGH", ["LOW", "MEDIUM"])).toBe(1);
    expect(severityBias("HIGH", ["LOW", "MEDIUM"])).toBe(1); // too severe
    expect(severityDistance("INFORMATIONAL", ["MEDIUM", "LOW"])).toBe(1);
    expect(severityBias("INFORMATIONAL", ["LOW", "MEDIUM"])).toBe(-1); // too lenient
    expect(severityDistance(null, ["HIGH", "CRITICAL"])).toBe(3); // no findings = INFORMATIONAL
    expect(severityBias("MEDIUM", ["LOW", "MEDIUM"])).toBe(0);
  });

  it("is stable only when every run agrees", () => {
    expect(isStable(["HIGH", "HIGH", "HIGH"])).toBe(true);
    expect(isStable(["HIGH", "MEDIUM", "HIGH"])).toBe(false);
    expect(isStable([null, null])).toBe(true);
    expect(isStable([null, "INFORMATIONAL"])).toBe(true); // no findings == informational only
    expect(isStable([])).toBe(false);
  });
});

describe("retrieval and evidence metrics", () => {
  it("computes recall@k for several k from one ranking", () => {
    expect(recallAtKs([1, 3, null, 6], [1, 3, 5, 8])).toEqual({ "@1": 0.25, "@3": 0.5, "@5": 0.5, "@8": 0.75 });
  });

  it("requires every phrase for full-evidence recall", () => {
    const chunks = [{ content: "Invoices are payable within thirty (30) days." }, { content: "the Order Form prevails" }];
    expect(coversAllPhrases(chunks, ["thirty (30) days", "Order Form prevails"])).toBe(true);
    expect(coversAllPhrases(chunks.slice(0, 1), ["thirty (30) days", "Order Form prevails"])).toBe(false);
  });

  it("matches risk evidence quotes against expected phrases after normalisation", () => {
    expect(evidenceCovers(["The Subscription Term renews  automatically for…"], ["renews automatically"], normalizeForMatch)).toBe(true);
    expect(evidenceCovers(["Fees are non-refundable"], ["renews automatically"], normalizeForMatch)).toBe(false);
    expect(evidenceCovers([], ["x"], normalizeForMatch)).toBe(false);
  });
});

describe("numeric grounding", () => {
  const sources = new Map([
    ["S1", "Invoices are payable within thirty (30) days. Overdue amounts bear interest at 1.5% per month."],
    ["S2", "cyber liability insurance of not less than USD 5,000,000 per claim"],
  ]);
  it("checks each stated number against the sources its sentence cites", () => {
    const r = numericGrounding(splitCitedSentences("Invoices are due in 30 days [S1]. Interest is 1.5% per month [S1]. Insurance is USD 5,000,000 [S2]."), sources);
    expect(r).toEqual({ claims: 3, grounded: 3, ungrounded: [] });
  });
  it("flags numbers not in the cited source, and numbers in uncited sentences", () => {
    const r = numericGrounding(splitCitedSentences("Invoices are due in 45 days [S1]. Interest is 2% per month."), sources);
    expect(r.grounded).toBe(0);
    expect(r.ungrounded).toEqual(["45", "2%"]);
  });
  it("ignores citation markers, page and section references", () => {
    expect(numericGrounding(["See Section 12.3 on page 11 [S2]."], sources).claims).toBe(0);
  });
});

describe("summaries", () => {
  const row = (over: Partial<AnswerRow>): AnswerRow => ({
    contract: "c", split: "dev", id: "q", kind: "lookup", answerable: true, correct: true, abstained: false, citations: 1, invalidMarkers: [], unsupportedPageRefs: [],
    citationCoverage: 1, citationCorrect: true, citationPrecision: 1, numericClaims: 1, numericGrounded: 1, ungroundedNumbers: [], faithfulness: 1, unsupportedClaims: [], answer: "", ...over,
  });
  it("separates abstention accuracy from false abstentions and splits by kind", () => {
    const s = summarizeAnswers([row({}), row({ abstained: true, correct: false, kind: "conflict" }), row({ answerable: false, kind: "unanswerable", citationCoverage: null, citationCorrect: null, citationPrecision: null })]);
    expect(s.abstentionAccuracy).toBe(1);
    expect(s.falseAbstentionRate).toBe(0.5);
    expect(s.byKind.conflict).toEqual({ n: 1, correctness: 0 });
  });
  it("reports per-split and overall values", () => {
    const out = bySplit([row({ split: "dev" }), row({ split: "holdout", correct: false })], summarizeAnswers);
    expect([out.all.correctness, out.dev.correctness, out.holdout.correctness]).toEqual([0.5, 1, 0]);
  });
  it("computes severity stability only across repeated runs", () => {
    const run = (n: number, observed: "HIGH" | "MEDIUM"): RiskRunRow => ({
      contract: "c", split: "dev", run: n, status: "COMPLETED", identification: { recall: 1, precision: 1, missed: [], falsePositives: [] },
      severity: [{ category: "TERMINATION", observed, band: ["HIGH", "CRITICAL"], inBand: observed === "HIGH", distance: observed === "HIGH" ? 0 : 1, bias: observed === "HIGH" ? 0 : -1 }],
      evidenceCoverage: { TERMINATION: true }, findingsKept: 2, findingsDiscarded: 0, severityAdjustments: 0, structuredAttempts: 16, structuredFailures: 0, findings: [],
    });
    expect(summarizeRisk([run(1, "HIGH")]).severityStability).toBeNull();
    const s = summarizeRisk([run(1, "HIGH"), run(2, "MEDIUM")]);
    expect(s.severityStability).toBe(0);
    expect(s.severityAgreement).toBe(0.5);
    expect(s.underSeverityRate).toBe(0.5);
  });
});

describe("clause identification", () => {
  it("computes recall over expected categories and precision over scored ones", () => {
    const r = clauseIdentification(new Set(["TERMINATION", "PAYMENT", "AUTO_RENEWAL"]), ["TERMINATION", "PAYMENT", "WARRANTIES"], ["AUTO_RENEWAL", "DATA_PROTECTION"]);
    expect(r).toEqual({ recall: 0.667, precision: 0.667, missed: ["WARRANTIES"], falsePositives: ["AUTO_RENEWAL"] });
  });
});

describe("cost and latency", () => {
  it("prices uncached input, cached input and output separately", () => {
    expect(costUsd({ input: 1_000_000, cachedInput: 200_000, output: 100_000 }, { input: 0.1, cachedInput: 0.01, output: 0.5 })).toBe(0.132);
    expect(costUsd({ input: 1, cachedInput: 0, output: 1 }, undefined)).toBeNull();
    expect(costUsd({ input: 1, cachedInput: 0, output: 1 }, { input: null, output: 1 })).toBeNull();
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([100, 300, 200, 400], 50)).toBe(200);
    expect(percentile([100, 300, 200, 400], 95)).toBe(400);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("datasets", () => {
  it("loads v2 and normalises v1 to the same shape", () => {
    const v2 = loadDataset("evals/datasets/contract-qa.v2.json");
    expect(v2.contracts.map((c) => c.format)).toEqual(["pdf", "docx"]);
    expect(v2.contracts.every((c) => c.questions.filter((x) => x.answerable).every((x) => x.answerKeys?.length))).toBe(true);
    const v3 = loadDataset("evals/datasets/contract-qa.v3.json");
    expect(v3.contracts.map((c) => c.split)).toEqual(["dev", "dev", "holdout", "holdout"]);
    expect(v3.contracts.flatMap((c) => c.questions).filter((x) => !x.answerable)).toHaveLength(14);
    expect(v3.contracts.every((c) => Object.keys(c.riskExpectations.evidencePhrases).length > 0)).toBe(true);
    const v1 = loadDataset("evals/datasets/contract-qa.v1.json");
    expect(v1.contracts).toHaveLength(1);
    expect(v1.contracts[0].questions).toHaveLength(18);
  });
});

describe("dataset integrity", () => {
  it("every expected phrase and evidence phrase occurs in its contract text, and every banded category is expected", () => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
    for (const c of loadDataset("evals/datasets/contract-qa.v3.json").contracts) {
      const text = norm((c.pages ? c.pages.flat() : (c.sections ?? []).flatMap((s) => [s.heading, ...s.paragraphs])).join(" "));
      const phrases = [
        ...c.questions.flatMap((x) => [...(x.expectedPhrases ?? []), ...(x.expectedPhrasesAll ?? [])]),
        ...Object.values(c.riskExpectations.evidencePhrases).flat(),
      ];
      expect(phrases.filter((p) => !text.includes(norm(p))), c.id).toEqual([]);
      expect(Object.keys(c.riskExpectations.severityBands).filter((k) => !c.riskExpectations.identified.includes(k as never)), c.id).toEqual([]);
      expect(c.questions.filter((x) => x.answerable && !(x.answerKeys?.length || x.answerKeyGroups?.length)), c.id).toEqual([]);
    }
  });
});
