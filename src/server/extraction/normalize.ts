/**
 * Text normalisation for extracted contract text.
 *
 * Goal: remove extraction artefacts (soft line wraps, hyphenation, running
 * headers/footers, odd whitespace) WITHOUT destroying structure that matters for
 * legal reading: paragraph boundaries, clause numbering and headings.
 */

const PAGE_FURNITURE = [
  /^page\s+\d+(\s+of\s+\d+)?$/i,
  /^-?\s*\d{1,4}\s*-?$/, // "3", "- 3 -"
  /^\d{1,4}\s*\/\s*\d{1,4}$/, // "3/20"
  /^confidential$/i,
];

/** Clause numbering / list markers that should always start a new paragraph. */
const NEW_PARAGRAPH_START =
  /^(\(?[a-z]{1,3}\)|\(?[ivxlc]{1,6}\)|\d{1,2}(\.\d{1,3}){0,3}\.?\s|article\s+[0-9ivxlc]+|section\s+\d|•|▪|–\s|—\s|-\s)/i;

export function normalizeUnicode(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[   \t]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/­/g, ""); // soft hyphen
}

export function isPageFurniture(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length < 40 && PAGE_FURNITURE.some((re) => re.test(t));
}

/** Heuristic heading test used both for joining lines and for section detection. */
export function looksLikeHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 100) return false;
  if (/^(article|section)\s+[0-9ivxlc]+/i.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 12) return true;
  return /^\d{1,2}(\.\d{1,2}){0,3}\.?\s+[A-Z][^.;:]{2,80}\.?$/.test(t) && isTitleCase(t.replace(/^[\d.]+\s+/, ""));
}

export function isTitleCase(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0 || words.length > 10) return false;
  const minor = new Set(["of", "and", "or", "the", "to", "for", "in", "on", "a", "an", "by", "with", "&"]);
  const capitalised = words.filter((w) => minor.has(w.toLowerCase()) || /^[A-Z(“"]/.test(w)).length;
  return capitalised / words.length >= 0.8;
}

/**
 * Converts raw page text (one visual line per `\n`) into paragraphs.
 * Lines are re-joined when they look like soft wraps; numbered clauses and
 * headings always start a new paragraph.
 */
export function linesToParagraphs(raw: string): string[] {
  const lines = normalizeUnicode(raw)
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trimEnd());

  // Drop page furniture at the top/bottom of the page only (where running headers live).
  const trimmed = [...lines];
  for (let pass = 0; pass < 2; pass++) {
    while (trimmed.length && (trimmed[0].trim() === "" || isPageFurniture(trimmed[0]))) trimmed.shift();
    while (trimmed.length && (trimmed[trimmed.length - 1].trim() === "" || isPageFurniture(trimmed[trimmed.length - 1])))
      trimmed.pop();
  }

  const paragraphs: string[] = [];
  let current = "";
  const flush = () => {
    const p = current.replace(/\s+/g, " ").trim();
    if (p) paragraphs.push(p);
    current = "";
  };

  for (const line of trimmed) {
    const t = line.trim();
    if (t === "") {
      flush();
      continue;
    }
    if (looksLikeHeadingLine(t)) {
      flush();
      paragraphs.push(t.replace(/\s+/g, " "));
      continue;
    }
    if (current && NEW_PARAGRAPH_START.test(t)) flush();
    if (!current) {
      current = t;
    } else if (/[A-Za-z]-$/.test(current) && /^[a-z]/.test(t)) {
      // De-hyphenate words broken across lines: "termi-\nnation" -> "termination".
      current = current.slice(0, -1) + t;
    } else {
      current += " " + t;
    }
  }
  flush();
  return paragraphs;
}

/** Light clean-up for text that is already paragraph-structured (DOCX). */
export function normalizeParagraph(text: string): string {
  return normalizeUnicode(text).replace(/\s+/g, " ").trim();
}
