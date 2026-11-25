import type { FindingEvidence } from "@/lib/domain";
import { locateInChunk } from "@/server/chunking/chunker";
import type { ValidatableSource } from "@/server/rag/citations";
import { MAX_EVIDENCE_PER_FINDING, MAX_FINDINGS_PER_CATEGORY, type CategoryEvaluation, type FindingOutput } from "./schema";

/**
 * Evidence attribution for risk findings.
 *
 * A finding is only kept if at least one of its quotes can be located in the
 * source chunk it cites. This is the main guard against fabricated clauses:
 * the model may misjudge severity, but it cannot introduce contract language
 * that does not exist.
 */

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\[s\d+\]/g, "")
    .replace(/[^a-z0-9'"$%.,;:()\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^a-z0-9$%]+/)
    .filter(Boolean);
}

/**
 * EXACT: normalised quote is a substring of the normalised source.
 * NEAR:  ≥ 85% of the quote's word trigrams occur in the source (tolerates
 *        minor paraphrase/ellipsis by the model).
 * null:  not found – treated as unsupported.
 */
export function matchQuote(quote: string, source: string): FindingEvidence["match"] | null {
  const q = normalizeForMatch(quote).replace(/\.\.\.|…/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 8) return null;
  const s = normalizeForMatch(source);
  if (s.includes(q)) return "EXACT";

  const qt = tokens(q);
  if (qt.length < 4) return null;
  const st = tokens(s);
  const sourceTrigrams = new Set<string>();
  for (let i = 0; i + 3 <= st.length; i++) sourceTrigrams.add(st.slice(i, i + 3).join(" "));
  let hits = 0;
  let total = 0;
  for (let i = 0; i + 3 <= qt.length; i++) {
    total++;
    if (sourceTrigrams.has(qt.slice(i, i + 3).join(" "))) hits++;
  }
  return total > 0 && hits / total >= 0.85 ? "NEAR" : null;
}

/**
 * Character offset of a quote inside the raw source (first ~6 words matched
 * case- and whitespace-insensitively), or -1 when it cannot be pinned down.
 */
export function findQuoteOffset(quote: string, source: string): number {
  const words = quote.replace(/[“”"‘’'…]/g, " ").split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 6);
  if (words.length < 2) return -1;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\W]+");
  return new RegExp(pattern, "i").exec(source)?.index ?? -1;
}

/**
 * Builds a verified evidence item, located at the page/section where the
 * quote actually sits (not merely the chunk's overall range).
 */
function toEvidence(ref: { sourceId: string; quote: string }, src: ValidatableSource): FindingEvidence | null {
  const match = matchQuote(ref.quote, src.content);
  if (!match) return null;
  const start = findQuoteOffset(ref.quote, src.content);
  const at = locateInChunk(src.spans, start);
  const end = start >= 0 ? locateInChunk(src.spans, start + ref.quote.length - 1) : null;
  return {
    chunkId: src.chunkId,
    quote: ref.quote.trim(),
    match,
    pageStart: at ? at.page : src.pageStart,
    pageEnd: at ? (end?.page ?? at.page) : src.pageEnd,
    sectionTitle: at ? at.section : src.sectionTitle,
  };
}

/** Verifies the quotes the model gave to show WHERE a clause category appears. */
export function verifyClauseEvidence(refs: { sourceId: string; quote: string }[], sources: ValidatableSource[]): FindingEvidence[] {
  const byId = new Map(sources.map((s) => [s.id.toUpperCase(), s]));
  const out: FindingEvidence[] = [];
  for (const ref of refs) {
    const src = byId.get(ref.sourceId.trim().toUpperCase());
    const ev = src ? toEvidence(ref, src) : null;
    if (ev && !out.some((e) => e.chunkId === ev.chunkId && e.quote === ev.quote)) out.push(ev);
    if (out.length >= MAX_EVIDENCE_PER_FINDING) break;
  }
  return out;
}

export interface VerifiedFinding extends Omit<FindingOutput, "evidence"> {
  evidence: FindingEvidence[];
}

export interface EvidenceVerificationResult {
  findings: VerifiedFinding[];
  discarded: number;
}

export function verifyFindings(evaluation: CategoryEvaluation, sources: ValidatableSource[]): EvidenceVerificationResult {
  const byId = new Map(sources.map((s) => [s.id.toUpperCase(), s]));
  const findings: VerifiedFinding[] = [];
  let discarded = 0;

  for (const finding of evaluation.findings.slice(0, MAX_FINDINGS_PER_CATEGORY)) {
    const evidence: FindingEvidence[] = [];
    for (const ref of finding.evidence) {
      const src = byId.get(ref.sourceId.trim().toUpperCase());
      if (!src) continue; // cites a source that was never provided
      const ev = toEvidence(ref, src);
      if (!ev) continue; // quote not present in the cited source
      if (evidence.some((e) => e.chunkId === ev.chunkId && e.quote === ev.quote)) continue;
      evidence.push(ev);
      if (evidence.length >= MAX_EVIDENCE_PER_FINDING) break;
    }
    if (evidence.length === 0) {
      discarded++;
      continue;
    }
    findings.push({ ...finding, evidence });
  }
  // Excess findings beyond the cap are counted as discarded for transparency.
  discarded += Math.max(0, evaluation.findings.length - MAX_FINDINGS_PER_CATEGORY);
  return { findings, discarded };
}
