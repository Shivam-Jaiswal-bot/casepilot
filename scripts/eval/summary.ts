import type { AnswerRow, RetrievalRow } from "./answers";
import type { RiskRunRow } from "./risk";
import { isStable, mean, recallAtKs } from "./metrics";

/**
 * Pure aggregation of evaluation rows into report metrics (unit tested).
 * Every metric is null when nothing was measured — never estimated.
 */

const ratio = (num: number, den: number) => (den ? Number((num / den).toFixed(3)) : null);
const nonNull = <T>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);

export function summarizeRetrieval(rows: RetrievalRow[], ks: number[]) {
  const ranks = rows.map((r) => r.rank);
  const full = nonNull(rows.map((r) => r.fullEvidence));
  return {
    questions: rows.length,
    recall: recallAtKs(ranks, ks),
    mrr: mean(ranks.map((r) => (r ? 1 / r : 0))),
    /** Conflict / cross-reference questions where every required passage was in the top-K answer context. */
    fullEvidenceRecall: full.length ? mean(full.map((b) => (b ? 1 : 0))) : null,
    fullEvidenceQuestions: full.length,
  };
}

export function summarizeAnswers(rows: AnswerRow[]) {
  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const markers = answerable.reduce((n, r) => n + r.citations + r.invalidMarkers.length, 0);
  const claims = rows.reduce((n, r) => n + r.numericClaims, 0);
  const byKind: Record<string, { n: number; correctness: number | null }> = {};
  for (const kind of [...new Set(rows.map((r) => r.kind))]) {
    const xs = rows.filter((r) => r.kind === kind);
    byKind[kind] = { n: xs.length, correctness: mean(xs.map((r) => (r.correct ? 1 : 0))) };
  }
  return {
    questions: rows.length,
    correctness: mean(rows.map((r) => (r.correct ? 1 : 0))),
    answerableCorrectness: mean(answerable.map((r) => (r.correct ? 1 : 0))),
    /** Unanswerable questions correctly declined. */
    abstentionAccuracy: mean(unanswerable.map((r) => (r.correct ? 1 : 0))),
    /** Answerable questions the system refused to answer (lower is better). */
    falseAbstentionRate: mean(answerable.map((r) => (r.abstained ? 1 : 0))),
    citationCoverage: mean(nonNull(answerable.map((r) => r.citationCoverage))),
    citationValidity: ratio(answerable.reduce((n, r) => n + r.citations, 0), markers),
    citationCorrectness: mean(nonNull(answerable.map((r) => r.citationCorrect)).map((b) => (b ? 1 : 0))),
    citationPrecision: mean(nonNull(answerable.map((r) => r.citationPrecision))),
    unsupportedPageRefs: rows.reduce((n, r) => n + r.unsupportedPageRefs.length, 0),
    numericGrounding: ratio(rows.reduce((n, r) => n + r.numericGrounded, 0), claims),
    numericClaims: claims,
    faithfulness: mean(nonNull(rows.map((r) => r.faithfulness))),
    faithfulnessJudged: nonNull(rows.map((r) => r.faithfulness)).length,
    byKind,
  };
}

export function summarizeRisk(rows: RiskRunRow[]) {
  const sev = rows.flatMap((r) => r.severity);
  const kept = rows.reduce((n, r) => n + r.findingsKept, 0);
  const discarded = rows.reduce((n, r) => n + r.findingsDiscarded, 0);
  const evidence = rows.flatMap((r) => Object.values(r.evidenceCoverage));
  const attempts = rows.reduce((n, r) => n + r.structuredAttempts, 0);
  const failures = rows.reduce((n, r) => n + r.structuredFailures, 0);

  // Stability: for each (contract, category), did every repeated run give the same max severity?
  const groups = new Map<string, (RiskRunRow["severity"][number]["observed"])[]>();
  for (const r of rows) for (const s of r.severity) groups.set(`${r.contract}/${s.category}`, [...(groups.get(`${r.contract}/${s.category}`) ?? []), s.observed]);
  const repeated = [...groups.values()].filter((g) => g.length > 1);

  return {
    runs: rows.length,
    clauseRecall: mean(nonNull(rows.map((r) => r.identification.recall))),
    clausePrecision: mean(nonNull(rows.map((r) => r.identification.precision))),
    severityAgreement: mean(sev.map((s) => (s.inBand ? 1 : 0))),
    severityJudgements: sev.length,
    meanSeverityDistance: mean(sev.map((s) => s.distance)),
    overSeverityRate: mean(sev.map((s) => (s.bias === 1 ? 1 : 0))),
    underSeverityRate: mean(sev.map((s) => (s.bias === -1 ? 1 : 0))),
    severityStability: repeated.length ? mean(repeated.map((g) => (isStable(g) ? 1 : 0))) : null,
    stabilityCategories: repeated.length,
    evidenceCoverage: evidence.length ? mean(evidence.map((b) => (b ? 1 : 0))) : null,
    findingVerificationRate: ratio(kept, kept + discarded),
    findingsKept: kept,
    findingsDiscarded: discarded,
    severityAdjustments: rows.reduce((n, r) => n + r.severityAdjustments, 0),
    structuredOutputValidity: attempts ? Number((1 - failures / attempts).toFixed(3)) : null,
    structuredAttempts: attempts,
    structuredFailures: failures,
  };
}

/** Applies a summarizer to all rows and to each split ("dev" / "holdout"). */
export function bySplit<R extends { split: string }, S>(rows: R[], summarize: (rows: R[]) => S): Record<string, S> {
  const out: Record<string, S> = { all: summarize(rows) };
  for (const split of [...new Set(rows.map((r) => r.split))].sort()) out[split] = summarize(rows.filter((r) => r.split === split));
  return out;
}
