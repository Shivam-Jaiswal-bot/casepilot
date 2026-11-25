import { isTitleCase, looksLikeHeadingLine } from "./normalize";
import type { ExtractedSegment, StructuredBlock } from "./types";

/**
 * Section detection for contracts.
 *
 * Contracts encode structure through numbering ("12.", "12.2", "Article IV")
 * and typography (ALL CAPS headings). We track a two-level section path:
 * level 1 = article / top-level clause, level 2 = sub-clause. DOCX heading
 * styles, when present, take precedence over the heuristics.
 */

export interface HeadingInfo {
  title: string;
  level: 1 | 2;
  /** Body text that followed an inline heading ("12.1 Termination. Either party may…"). */
  remainder: string | null;
}

const MAX_TITLE = 90;

function clampTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").replace(/[.:;\s]+$/, "").trim();
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
}

export function detectHeading(text: string, explicitLevel?: number): HeadingInfo | null {
  const t = text.trim();
  if (explicitLevel !== undefined) {
    return { title: clampTitle(t), level: explicitLevel <= 1 ? 1 : 2, remainder: null };
  }

  const article = t.match(/^(article|section)\s+([0-9ivxlc]+(?:\.\d+)*)\b[.:\-–—]?\s*(.*)$/i);
  if (article && t.length <= 120) {
    const isSub = article[2].includes(".");
    return { title: clampTitle(t), level: isSub ? 2 : 1, remainder: null };
  }

  // Numbered heading with inline body: "12.1 Termination for Convenience. Either party may ..."
  const inline = t.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([A-Z][^.;:]{2,70})\.\s+(\S.*)$/);
  if (inline && isTitleCase(inline[2])) {
    const level = inline[1].includes(".") && !/^\d+\.$/.test(inline[1]) ? 2 : 1;
    return { title: clampTitle(`${inline[1]} ${inline[2]}`), level, remainder: inline[3] };
  }

  if (looksLikeHeadingLine(t)) {
    const numbered = t.match(/^(\d{1,2}(?:\.\d{1,2})+)/);
    return { title: clampTitle(t), level: numbered ? 2 : 1, remainder: null };
  }
  return null;
}

/**
 * Flattens extracted segments into structured blocks annotated with the
 * section path in force at that point of the document. Section state carries
 * across page boundaries, because clauses routinely continue onto the next page.
 */
export function buildStructuredBlocks(segments: ExtractedSegment[]): StructuredBlock[] {
  const out: StructuredBlock[] = [];
  let level1: string | null = null;
  let level2: string | null = null;

  const sectionPath = () => (level1 && level2 ? `${level1} › ${level2}` : (level2 ?? level1));

  for (const segment of segments) {
    for (const block of segment.blocks) {
      const text = block.text.trim();
      if (!text) continue;
      const heading = detectHeading(text, block.headingLevel);
      if (heading) {
        if (heading.level === 1) {
          level1 = heading.title;
          level2 = null;
        } else {
          level2 = heading.title;
        }
        if (heading.remainder) {
          out.push({ text: heading.title, pageNumber: segment.pageNumber, segmentIndex: segment.index, sectionTitle: sectionPath(), isHeading: true });
          out.push({ text: heading.remainder, pageNumber: segment.pageNumber, segmentIndex: segment.index, sectionTitle: sectionPath(), isHeading: false });
        } else {
          out.push({ text, pageNumber: segment.pageNumber, segmentIndex: segment.index, sectionTitle: sectionPath(), isHeading: true });
        }
        continue;
      }
      out.push({ text, pageNumber: segment.pageNumber, segmentIndex: segment.index, sectionTitle: sectionPath(), isHeading: false });
    }
  }
  return out;
}

/** The first heading of a segment (used to label DOCX sections in the viewer). */
export function segmentTitle(blocks: StructuredBlock[], segmentIndex: number): string | null {
  return blocks.find((b) => b.segmentIndex === segmentIndex)?.sectionTitle ?? null;
}
