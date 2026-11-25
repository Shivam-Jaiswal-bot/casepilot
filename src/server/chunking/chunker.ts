import type { StructuredBlock } from "@/server/extraction/types";

/**
 * Structure-aware chunker for legal documents.
 *
 * Strategy (greedy packing over paragraph "units"):
 *  1. Paragraphs longer than `maxTokens` are split at sentence boundaries.
 *  2. Units are packed into a chunk until adding the next one would exceed
 *     `targetTokens`.
 *  3. A new section heading closes the current chunk if the chunk is already
 *     reasonably full (≥ half the target). This keeps a clause and its heading
 *     together instead of splitting a clause across two chunks.
 *  4. When a chunk is closed mid-section, the next chunk is seeded with the
 *     trailing sentences of the previous one (up to `overlapTokens`), so
 *     provisions that straddle a boundary are retrievable from either side.
 *
 * Complexity: O(n) in the number of sentences; each unit is visited once and
 * overlap seeding looks back over a bounded number of sentences.
 */

export interface ChunkingOptions {
  targetTokens: number;
  maxTokens: number;
  overlapTokens: number;
}

export interface Chunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  metadata: {
    segmentIndexes: number[];
    /** Every section path this chunk covers (excluding overlap). */
    sectionTitles: string[];
    overlapTokens: number;
    startsAtHeading: boolean;
    /** Character offset → page/section map, so a quote can be located precisely inside the chunk. */
    spans: ChunkSpan[];
  };
}

export interface ChunkSpan {
  /** Offset into `content` where this unit starts. */
  offset: number;
  page: number | null;
  section: string | null;
}

/** Page and section at a character offset of a chunk (the last span starting at or before it). */
export function locateInChunk(spans: ChunkSpan[] | undefined, offset: number): ChunkSpan | null {
  if (!spans?.length || offset < 0) return null;
  let found: ChunkSpan | null = null;
  for (const span of spans) {
    if (span.offset <= offset) found = span;
    else break;
  }
  return found;
}

/** Approximate token count (≈4 characters per token for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const ABBREVIATIONS = /\b(?:Sec|Secs|No|Nos|Art|Inc|Ltd|Co|Corp|LLC|L\.L\.C|U\.S|e\.g|i\.e|etc|vs|Mr|Ms|Mrs|Dr|cf|para|pp|p)\.$/i;

/** Sentence splitter tuned for legal prose (keeps "Sec. 4", "U.S.", "e.g." intact). */
export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  const re = /[^.;!?]+(?:[.;!?]+|$)["”')\]]*\s*/g;
  let buffer = "";
  for (const match of text.match(re) ?? [text]) {
    buffer += match;
    const trimmed = buffer.trimEnd();
    if (ABBREVIATIONS.test(trimmed) || /\b[A-Z]\.$/.test(trimmed) || /\d\.$/.test(trimmed)) continue;
    parts.push(buffer.trim());
    buffer = "";
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts.filter(Boolean);
}

interface Unit {
  text: string;
  tokens: number;
  pageNumber: number | null;
  segmentIndex: number;
  sectionTitle: string | null;
  isHeading: boolean;
  /** True when this unit begins a paragraph (used to join units with blank lines). */
  paragraphStart: boolean;
}

/** Hard-split a single over-long sentence by words (rare: tables, run-on schedules). */
function splitByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    if (estimateTokens([...cur, w].join(" ")) > maxTokens && cur.length) {
      out.push(cur.join(" "));
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

function toUnits(blocks: StructuredBlock[], opts: ChunkingOptions): Unit[] {
  const units: Unit[] = [];
  for (const b of blocks) {
    const base = { pageNumber: b.pageNumber, segmentIndex: b.segmentIndex, sectionTitle: b.sectionTitle, isHeading: b.isHeading };
    const tokens = estimateTokens(b.text);
    if (tokens <= opts.maxTokens || b.isHeading) {
      units.push({ ...base, text: b.text, tokens, paragraphStart: true });
      continue;
    }
    let first = true;
    for (const sentence of splitSentences(b.text)) {
      const pieces = estimateTokens(sentence) > opts.maxTokens ? splitByWords(sentence, opts.targetTokens) : [sentence];
      for (const piece of pieces) {
        units.push({ ...base, text: piece, tokens: estimateTokens(piece), paragraphStart: first });
        first = false;
      }
    }
  }
  return units;
}

/**
 * Section label for a chunk. When a chunk spans several sub-clauses of the same
 * article, label it "3. Term › 3.2 …; 3.3 …" so citations never point at only
 * the first sub-clause.
 */
function summarizeSections(units: Unit[]): string | null {
  const titles = [...new Set(units.map((u) => u.sectionTitle).filter((t): t is string => Boolean(t)))];
  if (titles.length <= 1) return titles[0] ?? null;
  const parts = titles.map((t) => t.split(" › "));
  const leaf = (p: string[]) => p[p.length - 1];
  // Many sections in one chunk (common for short clauses): show the range, not a list.
  if (titles.length > 3) return `${leaf(parts[0])} … ${leaf(parts[parts.length - 1])}`;
  const parents = new Set(parts.map((p) => p[0]));
  const label =
    parents.size === 1
      ? `${parts[0][0]} › ${parts.map((p) => p[p.length - 1]).filter((l) => l !== parts[0][0]).join("; ")}`
      : parts.map((p) => p[p.length - 1]).join("; ");
  return label.length > 160 ? `${label.slice(0, 159)}…` : label;
}

function joinUnits(units: Unit[]): string {
  return units.reduce((acc, u, i) => (i === 0 ? u.text : acc + (u.paragraphStart ? "\n\n" : " ") + u.text), "");
}

/** Offsets match `joinUnits` exactly; consecutive units with the same location are merged. */
function buildSpans(units: Unit[]): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  let offset = 0;
  units.forEach((u, i) => {
    if (i > 0) offset += u.paragraphStart ? 2 : 1;
    const last = spans[spans.length - 1];
    if (!last || last.page !== u.pageNumber || last.section !== u.sectionTitle) {
      spans.push({ offset, page: u.pageNumber, section: u.sectionTitle });
    }
    offset += u.text.length;
  });
  return spans;
}

export function chunkBlocks(blocks: StructuredBlock[], opts: ChunkingOptions): Chunk[] {
  const units = toUnits(blocks, opts);
  const chunks: Chunk[] = [];
  let current: Unit[] = [];
  let currentTokens = 0;
  /** Tokens / units at the start of `current` that were carried over from the previous chunk. */
  let overlapTokens = 0;
  let overlapCount = 0;

  /** Headings detached from the end of the previous chunk, to open the next one. */
  let carried: Unit[] = [];

  /** Callers guarantee `current` holds at least one unit beyond the carried-over overlap. */
  const emit = (final = false) => {
    // A heading belongs with the text that follows it: never end a chunk on a heading
    // (except at the very end of the document, where nothing follows).
    let cut = current.length;
    while (!final && cut > overlapCount + 1 && current[cut - 1].isHeading) cut--;
    carried = current.slice(cut);
    const body = current.slice(0, cut);
    current = body;

    const content = joinUnits(body);
    const own = body.slice(overlapCount);
    const pages = body.map((u) => u.pageNumber).filter((p): p is number => p !== null);
    chunks.push({
      chunkIndex: chunks.length,
      content,
      tokenCount: estimateTokens(content),
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
      sectionTitle: summarizeSections(own),
      metadata: {
        segmentIndexes: [...new Set(body.map((u) => u.segmentIndex))],
        sectionTitles: [...new Set(own.map((u) => u.sectionTitle).filter((t): t is string => Boolean(t)))],
        overlapTokens,
        startsAtHeading: (own[0] ?? body[0]).isHeading,
        spans: buildSpans(body),
      },
    });
  };

  const startNext = (withOverlap: boolean) => {
    const prev = current;
    current = [];
    currentTokens = 0;
    overlapTokens = 0;
    overlapCount = 0;
    if (carried.length) {
      // The next chunk opens with the carried heading(s); no overlap across a section boundary.
      current = carried;
      currentTokens = carried.reduce((n, u) => n + u.tokens, 0);
      carried = [];
      return;
    }
    if (!withOverlap || opts.overlapTokens <= 0) return;
    // Seed with trailing non-heading units of the previous chunk, within the same section.
    const seed: Unit[] = [];
    let tokens = 0;
    for (let i = prev.length - 1; i >= 0; i--) {
      const u = prev[i];
      if (u.isHeading || tokens + u.tokens > opts.overlapTokens) break;
      seed.unshift({ ...u, paragraphStart: seed.length === 0 ? true : u.paragraphStart });
      tokens += u.tokens;
    }
    if (seed.length && seed.length < prev.length) {
      current = seed;
      currentTokens = tokens;
      overlapTokens = tokens;
      overlapCount = seed.length;
    }
  };

  for (const unit of units) {
    const ownTokens = currentTokens - overlapTokens;
    const hasOwnContent = current.length > overlapCount;
    const sectionChanged = hasOwnContent && unit.sectionTitle !== current[current.length - 1].sectionTitle;

    if (hasOwnContent && unit.isHeading && ownTokens >= opts.targetTokens / 2) {
      emit();
      startNext(false); // never carry overlap across a section boundary
    } else if (hasOwnContent && currentTokens + unit.tokens > opts.targetTokens) {
      if (currentTokens + unit.tokens <= opts.maxTokens && ownTokens < opts.targetTokens / 3) {
        // Chunk is still small: accept a slight overshoot rather than emit a fragment.
      } else {
        emit();
        startNext(!sectionChanged && !unit.isHeading);
      }
    }
    current.push(unit);
    currentTokens += unit.tokens;
  }
  if (current.length > overlapCount) emit(true);
  return chunks;
}

/**
 * Text sent to the embedding model. A short contextual header (document title
 * and section path) markedly improves retrieval for chunks that do not repeat
 * the clause name in their body. The stored `content` stays verbatim so quotes
 * and citations always match the source.
 */
export function embeddingInput(chunk: Pick<Chunk, "content" | "sectionTitle">, documentTitle: string): string {
  const header = [`Document: ${documentTitle}`, chunk.sectionTitle ? `Section: ${chunk.sectionTitle}` : null]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${chunk.content}`;
}
