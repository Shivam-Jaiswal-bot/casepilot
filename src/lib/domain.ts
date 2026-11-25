/**
 * Domain vocabulary shared by server and client code.
 * Keep this file free of server-only imports so client components can use it.
 */

export const DOCUMENT_STATUSES = ["UPLOADED", "PROCESSING", "INDEXING", "COMPLETED", "FAILED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const ACTIVE_DOCUMENT_STATUSES: readonly DocumentStatus[] = ["UPLOADED", "PROCESSING", "INDEXING"];

export const FILE_TYPES = ["pdf", "docx"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const JOB_TYPES = ["PROCESS_DOCUMENT", "ANALYZE_RISK"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ANALYSIS_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const RISK_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Whether a finding rests on explicit contract language or on an interpretation of it. */
export const ASSESSMENT_BASES = ["EXPLICIT", "INTERPRETATION"] as const;
export type AssessmentBasis = (typeof ASSESSMENT_BASES)[number];

export const CLAUSE_CATEGORIES = [
  "TERMINATION",
  "INDEMNIFICATION",
  "LIMITATION_OF_LIABILITY",
  "CONFIDENTIALITY",
  "INTELLECTUAL_PROPERTY",
  "DATA_PROTECTION",
  "PAYMENT",
  "AUTO_RENEWAL",
  "GOVERNING_LAW",
  "DISPUTE_RESOLUTION",
  "ASSIGNMENT",
  "WARRANTIES",
  "NON_COMPETE_EXCLUSIVITY",
  "FORCE_MAJEURE",
  "BREACH_REMEDIES",
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export const CLAUSE_CATEGORY_LABELS: Record<ClauseCategory, string> = {
  TERMINATION: "Termination",
  INDEMNIFICATION: "Indemnification",
  LIMITATION_OF_LIABILITY: "Limitation of liability",
  CONFIDENTIALITY: "Confidentiality",
  INTELLECTUAL_PROPERTY: "Intellectual property",
  DATA_PROTECTION: "Data protection & privacy",
  PAYMENT: "Payment obligations",
  AUTO_RENEWAL: "Automatic renewal",
  GOVERNING_LAW: "Governing law",
  DISPUTE_RESOLUTION: "Dispute resolution",
  ASSIGNMENT: "Assignment",
  WARRANTIES: "Warranties & representations",
  NON_COMPETE_EXCLUSIVITY: "Non-compete & exclusivity",
  FORCE_MAJEURE: "Force majeure",
  BREACH_REMEDIES: "Breach & remedies",
};

/**
 * Coverage outcome for a clause category in one analysis.
 * NOT_IDENTIFIED is deliberately distinct from a risk finding: absence in the
 * reviewed content is not proof that the contract is defective.
 */
export const CATEGORY_OUTCOMES = ["IDENTIFIED", "NOT_IDENTIFIED", "ERROR"] as const;
export type CategoryOutcome = (typeof CATEGORY_OUTCOMES)[number];

export interface CategoryCoverage {
  category: ClauseCategory;
  outcome: CategoryOutcome;
  summary: string;
  findingCount: number;
  /** Findings proposed by the model but discarded because their evidence could not be verified. */
  discardedFindings: number;
  /** Verified quotes locating the provision (IDENTIFIED only). Optional for analyses stored before this field existed. */
  evidence?: FindingEvidence[];
}

export type SeverityCounts = Record<RiskSeverity, number>;

export const emptySeverityCounts = (): SeverityCounts => ({
  CRITICAL: 0,
  HIGH: 0,
  MEDIUM: 0,
  LOW: 0,
  INFORMATIONAL: 0,
});

/** A location inside a document. Page numbers are only present for paginated formats (PDF). */
export interface SourceLocation {
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
}

/** A validated citation attached to an assistant answer. */
export interface Citation extends SourceLocation {
  /** Marker used in the answer text, e.g. "S1". */
  sourceId: string;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  excerpt: string;
}

export interface FindingEvidence extends SourceLocation {
  chunkId: string;
  quote: string;
  /** EXACT: quote found verbatim (after whitespace/quote normalisation); NEAR: ≥85% token overlap. */
  match: "EXACT" | "NEAR";
}

export function formatLocation(loc: SourceLocation): string {
  const parts: string[] = [];
  if (loc.pageStart != null) {
    parts.push(
      loc.pageEnd != null && loc.pageEnd !== loc.pageStart
        ? `pp. ${loc.pageStart}–${loc.pageEnd}`
        : `p. ${loc.pageStart}`,
    );
  }
  if (loc.sectionTitle) parts.push(loc.sectionTitle);
  return parts.length ? parts.join(" · ") : "Location unavailable";
}
