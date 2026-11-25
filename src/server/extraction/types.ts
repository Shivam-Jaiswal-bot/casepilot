import type { FileType } from "@/lib/domain";

/** A paragraph-level unit of text with structural hints. */
export interface TextBlock {
  text: string;
  /** Heading level when the extractor knows the block is a heading (DOCX styles). */
  headingLevel?: number;
}

/**
 * A segment is the unit the viewer displays and citations point into.
 * PDF: one segment per page. DOCX: one segment per heading-delimited section.
 */
export interface ExtractedSegment {
  index: number;
  pageNumber: number | null;
  blocks: TextBlock[];
}

export interface ExtractionResult {
  fileType: FileType;
  extractor: string;
  pageCount: number | null;
  segments: ExtractedSegment[];
  warnings: string[];
}

/** Block after normalisation + section detection: the chunker's input. */
export interface StructuredBlock {
  text: string;
  pageNumber: number | null;
  segmentIndex: number;
  /** Section path such as "12. Termination › 12.2 Termination for Cause". */
  sectionTitle: string | null;
  isHeading: boolean;
}
