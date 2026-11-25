import { extractText, getDocumentProxy } from "unpdf";
import { PipelineError } from "@/server/errors";
import { linesToParagraphs } from "./normalize";
import type { ExtractionResult } from "./types";

/** Pages with fewer characters than this are treated as image-only (scanned). */
const MIN_CHARS_PER_TEXT_PAGE = 20;

export async function extractPdf(data: Buffer): Promise<ExtractionResult> {
  let pages: string[];
  let totalPages: number;
  try {
    // Copy into a fresh Uint8Array: pdf.js transfers/detaches the buffer it is given.
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text;
    totalPages = result.totalPages;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password/i.test(message)) {
      throw new PipelineError("PDF_ENCRYPTED", "This PDF is password-protected. Remove the password and upload it again.", {
        retryable: false,
        cause: err,
      });
    }
    throw new PipelineError("PDF_UNREADABLE", "The PDF could not be read. It may be corrupt or malformed.", {
      retryable: false,
      cause: err,
    });
  }

  const warnings: string[] = [];
  const segments = pages.map((pageText, i) => ({
    index: i,
    pageNumber: i + 1,
    blocks: linesToParagraphs(pageText).map((text) => ({ text })),
  }));

  const textPages = segments.filter((s) => s.blocks.reduce((n, b) => n + b.text.length, 0) >= MIN_CHARS_PER_TEXT_PAGE);
  if (textPages.length === 0) {
    throw new PipelineError(
      "PDF_NO_TEXT",
      "No extractable text was found. The PDF appears to be scanned images; OCR is not supported yet.",
      { retryable: false },
    );
  }
  const imageOnly = totalPages - textPages.length;
  if (imageOnly > 0) {
    warnings.push(`${imageOnly} of ${totalPages} pages contain little or no extractable text (possibly scanned) and may not be searchable.`);
  }

  return { fileType: "pdf", extractor: "unpdf", pageCount: totalPages, segments, warnings };
}
