import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { DOCUMENT_STATUSES, FILE_TYPES } from "@/lib/domain";
import { EMBEDDING_COLUMN_DIMENSIONS } from "@/server/config/env";
import { user } from "./auth";

export const documentStatusEnum = pgEnum("document_status", DOCUMENT_STATUSES);
export const fileTypeEnum = pgEnum("file_type", FILE_TYPES);

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Tenancy model: CasePilot isolates data per user (`owner_id`). Every
 * tenant-owned table carries owner_id directly – including chunks – so that
 * retrieval queries can filter on ownership without a join and a missing join
 * condition can never leak another tenant's embeddings.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    fileType: fileTypeEnum("file_type").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** Opaque storage key – never derived from user input. */
    storageKey: text("storage_key").notNull(),
    status: documentStatusEnum("status").notNull().default("UPLOADED"),
    /** User-safe failure description (no stack traces / internals). */
    errorMessage: text("error_message"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    /** Extraction metadata: extractor, warnings, character counts. */
    extractionMeta: jsonb("extraction_meta").$type<Record<string, unknown>>(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    index("documents_owner_status_idx").on(t.ownerId, t.status),
    // The same user uploading byte-identical content twice is almost always a mistake.
    uniqueIndex("documents_owner_sha256_uq").on(t.ownerId, t.sha256),
  ],
);

/**
 * Ordered text segments used by the document viewer and for evidence display.
 * PDF: one segment per page (page_number set).
 * DOCX: one segment per heading-delimited section (page_number null – DOCX has no fixed pagination).
 */
export const documentSegments = pgTable(
  "document_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    segmentIndex: integer("segment_index").notNull(),
    pageNumber: integer("page_number"),
    sectionTitle: text("section_title"),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("document_segments_doc_idx_uq").on(t.documentId, t.segmentIndex)],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    sectionTitle: text("section_title"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    /** Source metadata: char offsets, segment indexes, extractor, embedding model. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    embedding: vector("embedding", { dimensions: EMBEDDING_COLUMN_DIMENSIONS }).notNull(),
    /** Full-text search vector, maintained by Postgres. Section title is weighted above body text. */
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(section_title, '')), 'A') || setweight(to_tsvector('english', content), 'B')`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_chunks_doc_chunk_uq").on(t.documentId, t.chunkIndex),
    index("document_chunks_owner_doc_idx").on(t.ownerId, t.documentId),
    // HNSW gives good recall/latency without a training step (unlike IVFFlat),
    // and stays accurate as chunks are inserted incrementally.
    index("document_chunks_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("document_chunks_search_vector_idx").using("gin", t.searchVector),
  ],
);
