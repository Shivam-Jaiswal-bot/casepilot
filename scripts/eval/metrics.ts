import { RISK_SEVERITIES, type RiskSeverity } from "@/lib/domain";
import type { EvalQuestion } from "./dataset";

/**
 * Pure metric functions (unit tested). Every metric is deterministic given the
 * model outputs; the only model-judged metric (faithfulness) lives in eval.ts.
 */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, "x") // "2×" == "2x"
    .replace(/\*\*|__/g, ""); // markdown emphasis inside a key phrase

export function mean(xs: number[]): number | null {
  return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null;
}

export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** A chunk is relevant when it covers an expected page (if any) AND contains an expected phrase (if any). */
export function isRelevant(chunk: { content: string; pageStart: number | null; pageEnd: number | null }, q: EvalQuestion): boolean {
  const pageOk =
    !q.expectedPages?.length ||
    q.expectedPages.some((p) => chunk.pageStart != null && p >= chunk.pageStart && p <= (chunk.pageEnd ?? chunk.pageStart));
  const phraseOk = !q.expectedPhrases?.length || q.expectedPhrases.some((ph) => norm(chunk.content).includes(norm(ph)));
  return pageOk && phraseOk;
}

const DECLINE_PATTERN =
  /\b(not (found|identified|addressed|mentioned|contain|include|specified|covered|stated|provided|set out)|no (provision|clause|mention|reference|information|such)|(does|do) not (include|contain|address|mention|specify|provide|state|set out|say|refer|identify)|couldn't find|could not find|isn't addressed|is not addressed|silent on)\b/i;

/** "No arbitration institution is identified…", "No specific penalty … was found…" */
const NO_X_IS_FOUND = /\bno\b[^.]{0,100}?\b(is|was|are|were)\s+(found|identified|stated|specified|mentioned|provided|set out|named)\b/i;

export function isDecline(text: string, abstained: boolean): boolean {
  return abstained || DECLINE_PATTERN.test(text) || NO_X_IS_FOUND.test(text);
}

/**
 * Answer correctness (deterministic proxy):
 *  - answerable: the answer contains at least one answer key and is not a refusal;
 *  - unanswerable: the answer declines / says the provision was not found.
 */
export function isAnswerCorrect(q: EvalQuestion, text: string, abstained: boolean): boolean {
  if (!q.answerable) return isDecline(text, abstained);
  if (abstained) return false;
  const t = norm(text);
  const groups = q.answerKeyGroups ?? (q.answerKeys ? [q.answerKeys] : []);
  return groups.length > 0 && groups.every((g) => g.some((k) => t.includes(norm(k))));
}

/** 1-based rank of the first relevant chunk, or null. */
export function firstRelevantRank(chunks: Parameters<typeof isRelevant>[0][], q: EvalQuestion): number | null {
  const i = chunks.findIndex((c) => isRelevant(c, q));
  return i >= 0 ? i + 1 : null;
}

/** Recall@k for several k from a single ranking (rank null = never retrieved). */
export function recallAtKs(ranks: (number | null)[], ks: number[]): Record<string, number | null> {
  return Object.fromEntries(ks.map((k) => [`@${k}`, mean(ranks.map((r) => (r != null && r <= k ? 1 : 0)))]));
}

/**
 * Full evidence recall for conflict / cross-reference questions: every phrase in
 * expectedPhrasesAll occurs in at least one of the top-k chunks.
 */
export function coversAllPhrases(chunks: { content: string }[], phrases: string[]): boolean {
  const texts = chunks.map((c) => norm(c.content));
  return phrases.every((p) => texts.some((t) => t.includes(norm(p))));
}

const NUMBER_RE = /(?<![\w.])\$?\d[\d,]*(?:\.\d+)?%?/g;
const PAGE_OR_MARKER_RE = /\[S\d+(?:\s*[,;]\s*S\d+)*\]|\b(?:pages?|pp?\.)\s*\d+(?:\s*(?:-|–|to|and)\s*\d+)?|\b(?:sections?|§|clause)\s*\d+(?:\.\d+)*/gi;
const canonNumber = (n: string) => n.replace(/[$,]/g, "").replace(/\.0+(?=%|$)/, "");

/**
 * Numeric grounding (deterministic faithfulness proxy): every number an answer
 * states (amounts, days, percentages) must appear in a source that the same
 * sentence cites. Citation markers, page and section references are ignored.
 * Numbers in uncited sentences count as ungrounded.
 */
export function numericGrounding(sentences: string[], sources: Map<string, string>): { claims: number; grounded: number; ungrounded: string[] } {
  let claims = 0;
  let grounded = 0;
  const ungrounded: string[] = [];
  for (const sentence of sentences) {
    const cited = [...sentence.matchAll(/S\d+/g)].map((m) => m[0]).filter((id) => sources.has(id));
    const numbers = (sentence.replace(PAGE_OR_MARKER_RE, " ").match(NUMBER_RE) ?? []).map(canonNumber);
    const haystack = cited.map((id) => sources.get(id) ?? "").join(" ");
    const sourceNumbers = new Set((haystack.match(NUMBER_RE) ?? []).map(canonNumber));
    for (const n of numbers) {
      claims++;
      if (sourceNumbers.has(n) || sourceNumbers.has(n.replace(/%$/, ""))) grounded++;
      else ungrounded.push(n);
    }
  }
  return { claims, grounded, ungrounded };
}

const rank = (s: RiskSeverity) => RISK_SEVERITIES.indexOf(s); // 0 = CRITICAL … 4 = INFORMATIONAL

/** Most severe level among findings, or null when a category produced no findings. */
export function maxSeverity(severities: RiskSeverity[]): RiskSeverity | null {
  if (!severities.length) return null;
  return severities.reduce((a, b) => (rank(a) <= rank(b) ? a : b));
}

/**
 * Whether the observed (most severe) level lies inside the acceptable band
 * [mildest, most severe] in either order. No findings counts as in-band only if the
 * band includes INFORMATIONAL (i.e. "nothing to flag" is an acceptable outcome).
 */
export function severityInBand(observed: RiskSeverity | null, band: [RiskSeverity, RiskSeverity]): boolean {
  const [a, b] = band;
  const lo = Math.min(rank(a), rank(b));
  const hi = Math.max(rank(a), rank(b));
  if (observed === null) return hi === rank("INFORMATIONAL");
  const r = rank(observed);
  return r >= lo && r <= hi;
}

/** Rank distance from the band (0 when in band); "no findings" counts as INFORMATIONAL. */
export function severityDistance(observed: RiskSeverity | null, band: [RiskSeverity, RiskSeverity]): number {
  const lo = Math.min(rank(band[0]), rank(band[1]));
  const hi = Math.max(rank(band[0]), rank(band[1]));
  const r = rank(observed ?? "INFORMATIONAL");
  return r < lo ? lo - r : r > hi ? r - hi : 0;
}

/** Signed direction of a miss: +1 too severe, -1 too lenient, 0 in band. */
export function severityBias(observed: RiskSeverity | null, band: [RiskSeverity, RiskSeverity]): -1 | 0 | 1 {
  const lo = Math.min(rank(band[0]), rank(band[1]));
  const r = rank(observed ?? "INFORMATIONAL");
  const d = severityDistance(observed, band);
  return d === 0 ? 0 : r < lo ? 1 : -1;
}

/**
 * True when the same category received the same (max) severity in every repeated run.
 * "No findings" and a single INFORMATIONAL finding are the same outcome (as in severityDistance).
 */
export function isStable(observed: (RiskSeverity | null)[]): boolean {
  const xs = observed.map((s) => s ?? "INFORMATIONAL");
  return xs.length > 0 && xs.every((s) => s === xs[0]);
}

/** Whether any verified quote for a category contains one of the expected phrases. */
export function evidenceCovers(quotes: string[], phrases: string[], normalise: (s: string) => string): boolean {
  const qs = quotes.map(normalise);
  return phrases.some((p) => {
    const np = normalise(p);
    return qs.some((q) => q.includes(np));
  });
}

/** Precision/recall of category identification against expected sets. Unlisted categories are not scored. */
export function clauseIdentification(identified: Set<string>, expected: string[], expectedAbsent: string[]) {
  const truePositives = expected.filter((c) => identified.has(c)).length;
  const falsePositives = expectedAbsent.filter((c) => identified.has(c));
  const scoredIdentified = truePositives + falsePositives.length;
  return {
    recall: expected.length ? Number((truePositives / expected.length).toFixed(3)) : null,
    precision: scoredIdentified ? Number((truePositives / scoredIdentified).toFixed(3)) : null,
    missed: expected.filter((c) => !identified.has(c)),
    falsePositives,
  };
}

export interface Pricing {
  input: number | null;
  cachedInput?: number | null;
  output: number | null;
}

/** USD cost from token counts and per-1M-token prices; null when prices are unknown. */
export function costUsd(tokens: { input: number; cachedInput: number; output: number }, price: Pricing | undefined): number | null {
  if (!price || price.input == null || price.output == null) return null;
  const uncached = Math.max(0, tokens.input - tokens.cachedInput);
  const cachedRate = price.cachedInput ?? price.input;
  return Number(((uncached * price.input + tokens.cachedInput * cachedRate + tokens.output * price.output) / 1_000_000).toFixed(4));
}
