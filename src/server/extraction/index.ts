import type { FileType } from "@/lib/domain";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import type { ExtractionResult } from "./types";

export type { ExtractionResult, ExtractedSegment, StructuredBlock, TextBlock } from "./types";
export { buildStructuredBlocks } from "./sections";

export async function extractDocument(fileType: FileType, data: Buffer): Promise<ExtractionResult> {
  switch (fileType) {
    case "pdf":
      return extractPdf(data);
    case "docx":
      return extractDocx(data);
  }
}
