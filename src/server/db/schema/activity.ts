import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ANALYSIS_STATUSES,
  ASSESSMENT_BASES,
  CLAUSE_CATEGORIES,
  CONFIDENCE_LEVELS,
  JOB_STATUSES,
  JOB_TYPES,
  RISK_SEVERITIES,
  type CategoryCoverage,
  type Citation,
  type FindingEvidence,
  type SeverityCounts,
} from "@/lib/domain";
import { user } from "./auth";
import { documents } from "./documents";

export const jobTypeEnum = pgEnum("job_type", JOB_TYPES);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const analysisStatusEnum = pgEnum("analysis_status", ANALYSIS_STATUSES);
export const severityEnum = pgEnum("risk_severity", RISK_SEVERITIES);
export const confidenceEnum = pgEnum("confidence_level", CONFIDENCE_LEVELS);
export const basisEnum = pgEnum("assessment_basis", ASSESSMENT_BASES);
export const clauseCategoryEnum = pgEnum("clause_category", CLAUSE_CATEGORIES);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

// ---------------------------------------------------------------------------
// Risk analyses (declared before jobs because jobs reference them)
// ---------------------------------------------------------------------------

export interface ContractProfile {
  contractType: string | null;
  parties: string[];
  summary: string;
}

export const riskAnalyses = pgTable(
  "risk_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: analysisStatusEnum("status").notNull().default("QUEUED"),
    /** Optional reviewer perspective, e.g. "We are the Customer". */
    perspective: text("perspective"),
    model: text("model"),
    profile: jsonb("profile").$type<ContractProfile>(),
    categoryCoverage: jsonb("category_coverage").$type<CategoryCoverage[]>().notNull().default([]),
    severityCounts: jsonb("severity_counts").$type<SeverityCounts>(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("risk_analyses_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    index("risk_analyses_document_idx").on(t.documentId, t.createdAt.desc()),
  ],
);

export const riskFindings = pgTable(
  "risk_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => riskAnalyses.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: clauseCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    severity: severityEnum("severity").notNull(),
    explanation: text("explanation").notNull(),
    businessImplication: text("business_implication").notNull(),
    reviewSuggestion: text("review_suggestion").notNull(),
    confidence: confidenceEnum("confidence").notNull(),
    basis: basisEnum("basis").notNull(),
    /** At least one verified evidence item is required (enforced in the risk service). */
    evidence: jsonb("evidence").$type<FindingEvidence[]>().notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("risk_findings_analysis_idx").on(t.analysisId, t.sortOrder),
    index("risk_findings_owner_idx").on(t.ownerId),
  ],
);

// ---------------------------------------------------------------------------
// Background processing jobs
// ---------------------------------------------------------------------------

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").notNull().default("QUEUED"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").references(() => riskAnalyses.id, { onDelete: "cascade" }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("processing_jobs_claim_idx").on(t.status, t.runAfter),
    index("processing_jobs_owner_idx").on(t.ownerId, t.status),
    // At most one active job per (document, type, analysis): enqueueing twice is a no-op.
    uniqueIndex("processing_jobs_active_uq")
      .on(t.documentId, t.type, sql`coalesce(${t.analysisId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.status} in ('QUEUED', 'RUNNING')`),
  ],
);

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null = conversation spans all of the owner's completed documents. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_owner_doc_idx").on(t.ownerId, t.documentId, t.updatedAt.desc())],
);

export interface RetrievalTrace {
  query: string;
  chunks: { chunkId: string; score: number; vectorRank: number | null; textRank: number | null }[];
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    /** Diagnostics: invalid citation markers / unsupported page references detected in the answer. */
    validation: jsonb("validation").$type<{ invalidMarkers: string[]; unsupportedPageRefs: number[]; abstained: boolean }>(),
    /** Audit trail of which chunks were retrieved (ids and scores only, no text). */
    retrieval: jsonb("retrieval").$type<RetrievalTrace>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);
