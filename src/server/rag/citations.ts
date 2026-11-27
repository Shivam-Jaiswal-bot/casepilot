import type { AnswerValidation } from "@/lib/chat-types";
import type { Citation } from "@/lib/domain";
import type { ChunkSpan } from "@/server/chunking/chunker";

/**
 * Post-generation citation validation.
 *
 * The model is asked to cite with [S#] markers. We do not trust those markers:
 *  - markers are resolved against the sources actually sent in the prompt;
 *    unknown markers are reported as invalid (and rendered as unverified);
 *  - page numbers mentioned in the prose are checked against page metadata of
 *    the retrieved chunks, catching fabricated page references;
 *  - coverage measures how much of the answer is backed by a citation.
 */

export interface ValidatableSource {
  id: string;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  content: string;
  spans?: ChunkSpan[];
}

/**
 * Citation markers: "[S1]" and grouped forms "[S1, S3]" / "[S1; S2]" (models
 * from different providers group citations differently).
 */
export const MARKER_GROUP_RE = /\[(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\]/g;
const MARKER_RE = MARKER_GROUP_RE;
const PAGE_REF_RE = /\b(?:pages?|pp?\.)\s*(\d{1,4})(?:\s*(?:-|–|to|and)\s*(\d{1,4}))?/gi;

export function extractMarkers(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(MARKER_GROUP_RE)) {
    for (const id of m[1].split(/\s*[,;]\s*/)) if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}

export function extractPageRefs(text: string): number[] {
  const pages = new Set<number>();
  for (const m of text.matchAll(PAGE_REF_RE)) {
    pages.add(Number(m[1]));
    if (m[2]) pages.add(Number(m[2]));
  }
  return [...pages];
}

/**
 * Splits text into sentences, attaching citation markers placed AFTER a
 * sentence's final period ("…to the Customer. [S2]") to that sentence — a
 * common citation style that would otherwise look uncited.
 */
export function splitCitedSentences(text: string): string[] {
  const fragments = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const leadingMarkers = new RegExp(`^((?:${MARKER_GROUP_RE.source}\\s*)+)`);
  const sentences: string[] = [];
  for (const fragment of fragments) {
    const m = leadingMarkers.exec(fragment);
    if (m && sentences.length) {
      sentences[sentences.length - 1] += ` ${m[1].trim()}`;
      const rest = fragment.slice(m[0].length).trim();
      if (rest) sentences.push(rest);
    } else sentences.push(fragment);
  }
  return sentences;
}

/** Fraction of substantive sentences (≥ 6 words, not disclaimers) that carry a citation marker. */
export function citationCoverage(text: string): number {
  const sentences = splitCitedSentences(text)
    .filter((s) => s.replace(MARKER_RE, "").split(/\s+/).filter(Boolean).length >= 6)
    .filter((s) => !/\b(legal advice|qualified (lawyer|attorney|counsel)|not (found|identified) in)\b/i.test(s));
  if (sentences.length === 0) return 1;
  const cited = sentences.filter((s) => new RegExp(MARKER_GROUP_RE.source).test(s)).length;
  return Number((cited / sentences.length).toFixed(3));
}

function excerpt(content: string, max = 600): string {
  return content.length > max ? `${content.slice(0, max).trimEnd()}…` : content;
}

export function validateAnswer(text: string, sources: ValidatableSource[]): AnswerValidation {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const markers = extractMarkers(text);

  const citations: Citation[] = [];
  const invalidMarkers: string[] = [];
  for (const marker of markers) {
    const src = byId.get(marker);
    if (!src) {
      invalidMarkers.push(marker);
      continue;
    }
    citations.push({
      sourceId: src.id,
      chunkId: src.chunkId,
      documentId: src.documentId,
      documentTitle: src.documentTitle,
      pageStart: src.pageStart,
      pageEnd: src.pageEnd,
      sectionTitle: src.sectionTitle,
      excerpt: excerpt(src.content),
    });
  }

  const knownPages = new Set<number>();
  for (const s of sources) {
    if (s.pageStart == null) continue;
    for (let p = s.pageStart; p <= (s.pageEnd ?? s.pageStart); p++) knownPages.add(p);
  }
  const unsupportedPageRefs = extractPageRefs(text).filter((p) => !knownPages.has(p));

  return { citations, invalidMarkers, unsupportedPageRefs, abstained: false, citationCoverage: citationCoverage(text) };
}

/** Strips [S#] markers from earlier assistant turns before they are replayed as history. */
export function stripMarkers(text: string): string {
  return text.replace(MARKER_RE, "").replace(/ {2,}/g, " ");
}
