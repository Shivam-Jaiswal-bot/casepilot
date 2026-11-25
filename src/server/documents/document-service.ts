import { createHash } from "node:crypto";
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { ACTIVE_DOCUMENT_STATUSES, type DocumentStatus } from "@/lib/domain";
import { getEnv } from "@/server/config/env";
import { getDb, type Database } from "@/server/db/client";
import { documents, documentSegments, processingJobs, riskAnalyses } from "@/server/db/schema";
import { AppError, notFound } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/job-queue";
import { logger } from "@/server/logging/logger";
import { getStorage, type DocumentStorage } from "@/server/storage/storage";
import { validateUpload } from "./file-validation";

/**
 * Document service: the only module that reads or writes `documents`.
 * Every function takes `ownerId` and scopes its queries by it, so an
 * authorisation check can never be forgotten at a call site.
 */

export type DocumentRecord = typeof documents.$inferSelect;
export type DocumentSummary = Omit<DocumentRecord, "storageKey" | "sha256" | "extractionMeta">;

const summaryColumns = {
  id: documents.id,
  ownerId: documents.ownerId,
  title: documents.title,
  originalFilename: documents.originalFilename,
  fileType: documents.fileType,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  status: documents.status,
  errorMessage: documents.errorMessage,
  pageCount: documents.pageCount,
  chunkCount: documents.chunkCount,
  processingStartedAt: documents.processingStartedAt,
  processedAt: documents.processedAt,
  lastAnalyzedAt: documents.lastAnalyzedAt,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

interface Deps {
  db: Database;
  storage: DocumentStorage;
}

const deps = (): Deps => ({ db: getDb(), storage: getStorage() });

export async function uploadDocument(
  ownerId: string,
  input: { filename: string; declaredMimeType?: string; data: Buffer },
  { db, storage }: Deps = deps(),
): Promise<DocumentSummary> {
  const env = getEnv();
  const file = validateUpload({ ...input, maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024 });
  const sha256 = createHash("sha256").update(input.data).digest("hex");

  const [existing] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(eq(documents.ownerId, ownerId), eq(documents.sha256, sha256)));
  if (existing) {
    throw new AppError("CONFLICT", `This file has already been uploaded as “${existing.title}”.`, {
      existingDocumentId: existing.id,
    });
  }

  const storageKey = await storage.put(ownerId, input.data);
  try {
    return await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          ownerId,
          title: file.title,
          originalFilename: file.filename,
          fileType: file.fileType,
          mimeType: file.mimeType,
          sizeBytes: input.data.length,
          sha256,
          storageKey,
          status: "UPLOADED",
        })
        .returning(summaryColumns);
      // Same transaction: a committed document always has a processing job.
      await enqueueJob(tx, { type: "PROCESS_DOCUMENT", ownerId, documentId: doc.id, maxAttempts: env.JOB_MAX_ATTEMPTS });
      logger.info("document.uploaded", { documentId: doc.id, fileType: file.fileType, bytes: input.data.length });
      return doc;
    });
  } catch (err) {
    // Don't leave orphaned files behind if the database write failed.
    await storage.delete(storageKey).catch(() => undefined);
    if (err instanceof Error && /documents_owner_sha256_uq/.test(err.message)) {
      throw new AppError("CONFLICT", "This file has already been uploaded.");
    }
    throw err;
  }
}

export interface ListDocumentsFilter {
  query?: string;
  status?: DocumentStatus | "ACTIVE";
  limit?: number;
}

export async function listDocuments(
  ownerId: string,
  filter: ListDocumentsFilter = {},
  db: Database = getDb(),
): Promise<DocumentSummary[]> {
  const conditions: SQL[] = [eq(documents.ownerId, ownerId)];
  if (filter.query?.trim()) {
    const pattern = `%${filter.query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(documents.title, pattern), ilike(documents.originalFilename, pattern))!);
  }
  if (filter.status === "ACTIVE") conditions.push(inArray(documents.status, [...ACTIVE_DOCUMENT_STATUSES]));
  else if (filter.status) conditions.push(eq(documents.status, filter.status));

  return db
    .select(summaryColumns)
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.createdAt))
    .limit(Math.min(filter.limit ?? 200, 500));
}

export async function getDocument(ownerId: string, documentId: string, db: Database = getDb()): Promise<DocumentRecord> {
  if (!isUuid(documentId)) throw notFound("Document");
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)));
  if (!doc) throw notFound("Document"); // 404 (not 403) so ids of other tenants are not confirmed.
  return doc;
}

export async function getDocumentFile(ownerId: string, documentId: string, { db, storage }: Deps = deps()) {
  const doc = await getDocument(ownerId, documentId, db);
  const data = await storage.get(doc.storageKey);
  return { doc, data };
}

export async function getDocumentSegments(ownerId: string, documentId: string, db: Database = getDb()) {
  await getDocument(ownerId, documentId, db);
  return db
    .select({
      segmentIndex: documentSegments.segmentIndex,
      pageNumber: documentSegments.pageNumber,
      sectionTitle: documentSegments.sectionTitle,
      text: documentSegments.text,
    })
    .from(documentSegments)
    .where(and(eq(documentSegments.documentId, documentId), eq(documentSegments.ownerId, ownerId)))
    .orderBy(documentSegments.segmentIndex);
}

/**
 * Deletes the document and – via ON DELETE CASCADE – its segments, chunks
 * (embeddings), jobs, conversations, messages, analyses and findings, then
 * removes the original file from storage.
 */
export async function deleteDocument(ownerId: string, documentId: string, { db, storage }: Deps = deps()): Promise<void> {
  const doc = await getDocument(ownerId, documentId, db);
  await db.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.ownerId, ownerId)));
  try {
    await storage.delete(doc.storageKey);
  } catch (err) {
    // The DB record is gone, so the file is unreachable; log for cleanup rather than fail the request.
    logger.error("document.storage_delete_failed", { documentId, error: err });
  }
  logger.info("document.deleted", { documentId });
}

/** Re-queues processing for a FAILED document. */
export async function retryDocument(ownerId: string, documentId: string, db: Database = getDb()): Promise<void> {
  const doc = await getDocument(ownerId, documentId, db);
  if (doc.status !== "FAILED") {
    throw new AppError("CONFLICT", "Only documents that failed processing can be retried.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ status: "UPLOADED", errorMessage: null, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
    await enqueueJob(tx, { type: "PROCESS_DOCUMENT", ownerId, documentId: doc.id, maxAttempts: getEnv().JOB_MAX_ATTEMPTS });
  });
}

export async function getDashboardStats(ownerId: string, db: Database = getDb()) {
  const [docStats] = await db
    .select({
      total: count(),
      completed: sql<number>`count(*) filter (where ${documents.status} = 'COMPLETED')`.mapWith(Number),
      processing: sql<number>`count(*) filter (where ${documents.status} in ('UPLOADED','PROCESSING','INDEXING'))`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${documents.status} = 'FAILED')`.mapWith(Number),
    })
    .from(documents)
    .where(eq(documents.ownerId, ownerId));

  const [jobStats] = await db
    .select({ failedJobs: count() })
    .from(processingJobs)
    .where(and(eq(processingJobs.ownerId, ownerId), eq(processingJobs.status, "FAILED")));

  const [analysisStats] = await db
    .select({ analyses: count() })
    .from(riskAnalyses)
    .where(and(eq(riskAnalyses.ownerId, ownerId), eq(riskAnalyses.status, "COMPLETED")));

  return { ...docStats, failedJobs: jobStats.failedJobs, completedAnalyses: analysisStats.analyses };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
