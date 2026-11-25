/**
 * Pure ranking utilities for hybrid retrieval (no I/O – unit tested directly).
 */
import type { ChunkSpan } from "@/server/chunking/chunker";

export interface Candidate {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  content: string;
  tokenCount: number;
  /** Offset → page/section map from chunk metadata (absent for legacy chunks). */
  spans?: ChunkSpan[];
}

export interface RankedList {
  /** Candidates ordered best-first. */
  items: Candidate[];
  kind: "vector" | "text";
}

export interface FusedCandidate extends Candidate {
  score: number;
  /** Best (1-based) rank achieved in any vector list / text list; null if absent. */
  vectorRank: number | null;
  textRank: number | null;
}

/**
 * Reciprocal Rank Fusion: score(d) = Σ_lists 1 / (k + rank_list(d)).
 *
 * RRF is used instead of mixing raw scores because cosine similarity and
 * ts_rank_cd live on incomparable scales; RRF needs only ranks, is robust to
 * outliers, and has no weights to tune. k = 60 is the value from the original
 * paper (Cormack et al., 2009) and dampens the advantage of top-1 positions.
 *
 * O(total candidates) time and space.
 */
export function reciprocalRankFusion(lists: RankedList[], k = 60): FusedCandidate[] {
  const byId = new Map<string, FusedCandidate>();
  for (const list of lists) {
    list.items.forEach((item, idx) => {
      const rank = idx + 1;
      const existing = byId.get(item.chunkId) ?? { ...item, score: 0, vectorRank: null, textRank: null };
      existing.score += 1 / (k + rank);
      if (list.kind === "vector") existing.vectorRank = Math.min(existing.vectorRank ?? Infinity, rank);
      else existing.textRank = Math.min(existing.textRank ?? Infinity, rank);
      byId.set(item.chunkId, existing);
    });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
}

function shingles(text: string, size = 5): Set<string> {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  if (out.size === 0 && words.length) out.add(words.join(" "));
  return out;
}

/** Overlap coefficient |A∩B| / min(|A|,|B|) over 5-word shingles. */
export function overlapCoefficient(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

/**
 * Removes candidates that mostly repeat text already selected (chunk overlap
 * windows, duplicated boilerplate). Keeps the higher-ranked one.
 */
export function dedupeCandidates<T extends Candidate>(ranked: T[], threshold = 0.6): T[] {
  const kept: T[] = [];
  for (const c of ranked) {
    const dup = kept.some((k) => k.documentId === c.documentId && overlapCoefficient(k.content, c.content) >= threshold);
    if (!dup) kept.push(c);
  }
  return kept;
}

/**
 * Greedy context packing: take candidates in rank order until either `topK`
 * chunks or `tokenBudget` tokens are reached. A candidate that would overflow
 * the budget is skipped (a smaller, lower-ranked one may still fit).
 */
export function selectWithinBudget<T extends Candidate>(ranked: T[], topK: number, tokenBudget: number): T[] {
  const selected: T[] = [];
  let used = 0;
  for (const c of ranked) {
    if (selected.length >= topK) break;
    if (used + c.tokenCount > tokenBudget) continue;
    selected.push(c);
    used += c.tokenCount;
  }
  return selected;
}

/**
 * Turns a natural-language question into an OR-ed tsquery string.
 * `websearch_to_tsquery` ANDs every term, which makes conversational questions
 * ("can the other party terminate without notice?") match almost nothing.
 * OR semantics + ts_rank_cd lets chunks matching more terms rank higher.
 */
export function toOrTsQuery(text: string): string | null {
  const terms = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !QUERY_STOPWORDS.has(t)),
    ),
  ].slice(0, 24);
  return terms.length ? terms.join(" | ") : null;
}

const QUERY_STOPWORDS = new Set(
  "the and for are but not you all any can was our has have had its into than then them they this that with from what when where who which does there their about contract agreement document clause clauses".split(
    " ",
  ),
);
