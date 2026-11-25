import type { FileType } from "@/lib/domain";
import { AppError } from "@/server/errors";

export const MIME_TYPES: Record<FileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface ValidatedFile {
  fileType: FileType;
  mimeType: string;
  /** Display title derived from the filename (extension removed, sanitised). */
  title: string;
  /** Sanitised original filename, safe for Content-Disposition. */
  filename: string;
}

/**
 * Detects the real file type from its bytes.
 *
 * - PDF: `%PDF-` header (allowing a little leading junk, which real-world PDFs sometimes carry).
 * - DOCX: ZIP local-file header `PK\x03\x04` AND a `word/document.xml` entry name.
 *   ZIP entry names are stored uncompressed, so a byte search is sufficient to
 *   tell a DOCX apart from other ZIP-based formats (XLSX, PPTX, plain archives).
 */
export function sniffFileType(data: Buffer): FileType | null {
  const head = data.subarray(0, 1024).toString("latin1");
  const pdfAt = head.indexOf("%PDF-");
  if (pdfAt >= 0 && pdfAt < 1024) return "pdf";

  if (data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    if (data.includes(Buffer.from("word/document.xml", "latin1"))) return "docx";
  }
  return null;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || "document";
}

export function validateUpload(input: {
  filename: string;
  declaredMimeType?: string;
  data: Buffer;
  maxBytes: number;
}): ValidatedFile {
  const { data, maxBytes } = input;
  if (data.length === 0) {
    throw new AppError("BAD_REQUEST", "The uploaded file is empty.");
  }
  if (data.length > maxBytes) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `The file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`,
    );
  }

  const detected = sniffFileType(data);
  if (!detected) {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Unsupported file. Only PDF and Word (.docx) documents are accepted.",
    );
  }

  const filename = sanitizeFilename(input.filename);
  const ext = filename.toLowerCase().split(".").pop();
  // The extension is informational only; content decides. A mismatch is still
  // rejected because it usually signals a mislabelled or tampered file.
  if (ext && (ext === "pdf" || ext === "docx") && ext !== detected) {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      `The file extension (.${ext}) does not match its contents (${detected.toUpperCase()}).`,
    );
  }

  const title = filename.replace(/\.(pdf|docx)$/i, "").trim() || "Untitled document";
  return { fileType: detected, mimeType: MIME_TYPES[detected], title, filename };
}
