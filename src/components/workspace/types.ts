import type { FileType, SourceLocation } from "@/lib/domain";

export interface WorkspaceDocument {
  id: string;
  title: string;
  fileType: FileType;
  pageCount: number | null;
}

export interface ViewerSegment {
  segmentIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  text: string;
}

/** Evidence currently focused in the viewer (from a chat citation or a risk finding). */
export interface FocusedEvidence extends SourceLocation {
  label: string;
  excerpt: string;
}
