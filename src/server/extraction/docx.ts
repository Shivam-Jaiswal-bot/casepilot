import mammoth from "mammoth";
import { PipelineError } from "@/server/errors";
import { normalizeParagraph } from "./normalize";
import { detectHeading } from "./sections";
import type { ExtractedSegment, ExtractionResult, TextBlock } from "./types";

/** DOCX has no fixed pages; long heading-less documents are split into viewer segments of this many blocks. */
const BLOCKS_PER_UNHEADED_SEGMENT = 40;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Converts mammoth's semantic HTML into ordered text blocks.
 * mammoth maps Word heading styles to <h1>…<h6>, which gives us reliable
 * section structure when authors used styles.
 */
export function htmlToBlocks(html: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const re = /<(h[1-6]|p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const text = normalizeParagraph(decodeEntities(m[2].replace(/<[^>]+>/g, " ")));
    if (!text) continue;
    blocks.push(tag[0] === "h" ? { text, headingLevel: Number(tag[1]) } : { text });
  }
  return blocks;
}

export function groupBlocksIntoSegments(blocks: TextBlock[]): ExtractedSegment[] {
  const segments: ExtractedSegment[] = [];
  let current: TextBlock[] = [];
  const flush = () => {
    if (current.length) segments.push({ index: segments.length, pageNumber: null, blocks: current });
    current = [];
  };

  for (const block of blocks) {
    const startsSection =
      (block.headingLevel !== undefined && block.headingLevel <= 3) ||
      (block.headingLevel === undefined && detectHeading(block.text)?.level === 1);
    if ((startsSection && current.length > 0) || current.length >= BLOCKS_PER_UNHEADED_SEGMENT) flush();
    current.push(block);
  }
  flush();
  return segments;
}

export async function extractDocx(data: Buffer): Promise<ExtractionResult> {
  let html: string;
  const warnings: string[] = [];
  try {
    const result = await mammoth.convertToHtml({ buffer: data });
    html = result.value;
    const unsupported = result.messages.filter((msg) => msg.type === "warning").length;
    if (unsupported > 0) warnings.push(`${unsupported} formatting element(s) could not be converted; text content is unaffected.`);
  } catch (err) {
    throw new PipelineError("DOCX_UNREADABLE", "The Word document could not be read. It may be corrupt or not a valid .docx file.", {
      retryable: false,
      cause: err,
    });
  }

  const blocks = htmlToBlocks(html);
  if (blocks.reduce((n, b) => n + b.text.length, 0) < 20) {
    throw new PipelineError("DOCX_NO_TEXT", "The Word document contains no extractable text.", { retryable: false });
  }

  return { fileType: "docx", extractor: "mammoth", pageCount: null, segments: groupBlocksIntoSegments(blocks), warnings };
}
