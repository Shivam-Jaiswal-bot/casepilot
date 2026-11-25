import { and, eq, sql } from "drizzle-orm";
import { getEmbedder, type Embedder } from "@/server/ai/embeddings";
import { chunkBlocks, embeddingInput } from "@/server/chunking/chunker";
import { getEnv } from "@/server/config/env";
import { getDb, type Database } from "@/server/db/client";
import { documentChunks, documents, documentSegments } from "@/server/db/schema";
import { PipelineError } from "@/server/errors";
import { buildStructuredBlocks, extractDocument } from "@/server/extraction";
import { sniffFileType } from "@/server/documents/file-validation";
import { logger } from "@/server/logging/logger";
import { getStorage, type DocumentStorage } from "@/server/storage/storage";

export interface ProcessingDeps {
  db: Database;
  storage: DocumentStorage;
  embedder: Embedder;
  chunking: { targetTokens: number; maxTokens: number; overlapTokens: number };
}

export function defaultProcessingDeps(): ProcessingDeps {
  const env = getEnv();
  return {
    db: getDb(),
    storage: getStorage(),
    embedder: getEmbedder(),
    chunking: {
      targetTokens: env.CHUNK_TARGET_TOKENS,
      maxTokens: env.CHUNK_MAX_TOKENS,
      overlapTokens: env.CHUNK_OVERLAP_TOKENS,
    },
  };
}

const INSERT_BATCH = 200;

/**
 * Full ingestion pipeline for one document:
 * validate → extract → structure/sections → chunk → embed → store.
 *
 * Idempotency: everything derived from the file (segments, chunks) is replaced
 * inside a single transaction at the end. A retry after a crash or a failed
 * embedding call therefore never produces duplicate chunks, and readers never
 * observe a half-indexed document.
 */
export async function processDocument(documentId: string, ownerId: string, deps: ProcessingDeps): Promise<void> {
  const { db } = deps;
  const startedAt = Date.now();

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)));
  if (!doc) {
    // Document was deleted while the job was queued – nothing to do.
    throw new PipelineError("DOCUMENT_GONE", "The document no longer exists.", { retryable: false });
  }

  await setStatus(db, documentId, "PROCESSING", { processingStartedAt: new Date(), errorMessage: null });

  let data: Buffer;
  try {
    data = await deps.storage.get(doc.storageKey);
  } catch (err) {
    throw new PipelineError("STORAGE_READ_FAILED", "The original file could not be read from storage.", {
      retryable: true,
      cause: err,
    });
  }

  // Re-validate stored bytes: never trust metadata recorded at upload time alone.
  if (sniffFileType(data) !== doc.fileType) {
    throw new PipelineError("FILE_TYPE_MISMATCH", "The stored file does not match its recorded type.", { retryable: false });
  }

  const extraction = await extractDocument(doc.fileType, data);
  const blocks = buildStructuredBlocks(extraction.segments);
  const chunks = chunkBlocks(blocks, deps.chunking);
  if (chunks.length === 0) {
    throw new PipelineError("NO_CONTENT", "No indexable text was found in this document.", { retryable: false });
  }

  await setStatus(db, documentId, "INDEXING");

  const vectors = await deps.embedder.embedDocuments(chunks.map((c) => embeddingInput(c, doc.title)));
  if (vectors.length !== chunks.length) {
    throw new PipelineError("EMBEDDING_MISMATCH", "Embedding generation returned an unexpected number of vectors.", {
      retryable: true,
    });
  }

  const segmentRows = extraction.segments.map((s) => {
    const segBlocks = blocks.filter((b) => b.segmentIndex === s.index);
    return {
      documentId,
      ownerId,
      segmentIndex: s.index,
      pageNumber: s.pageNumber,
      sectionTitle: segBlocks.find((b) => b.isHeading)?.sectionTitle ?? segBlocks[0]?.sectionTitle ?? null,
      text: s.blocks.map((b) => b.text).join("\n\n"),
    };
  });

  const chunkRows = chunks.map((c, i) => ({
    documentId,
    ownerId,
    chunkIndex: c.chunkIndex,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    sectionTitle: c.sectionTitle,
    content: c.content,
    tokenCount: c.tokenCount,
    metadata: {
      ...c.metadata,
      extractor: extraction.extractor,
      embeddingModel: deps.embedder.id,
      fileType: doc.fileType,
    },
    embedding: vectors[i],
  }));

  await db.transaction(async (tx) => {
    // Lock the document row so a concurrent delete cannot interleave with re-indexing.
    const locked = await tx.execute(sql`select id from documents where id = ${documentId} for update`);
    if (locked.length === 0) {
      throw new PipelineError("DOCUMENT_GONE", "The document no longer exists.", { retryable: false });
    }
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
    await tx.delete(documentSegments).where(eq(documentSegments.documentId, documentId));
    for (let i = 0; i < segmentRows.length; i += INSERT_BATCH) {
      await tx.insert(documentSegments).values(segmentRows.slice(i, i + INSERT_BATCH));
    }
    for (let i = 0; i < chunkRows.length; i += INSERT_BATCH) {
      await tx.insert(documentChunks).values(chunkRows.slice(i, i + INSERT_BATCH));
    }
    await tx
      .update(documents)
      .set({
        status: "COMPLETED",
        errorMessage: null,
        pageCount: extraction.pageCount,
        chunkCount: chunkRows.length,
        extractionMeta: {
          extractor: extraction.extractor,
          warnings: extraction.warnings,
          segmentCount: segmentRows.length,
          characterCount: segmentRows.reduce((n, s) => n + s.text.length, 0),
          embeddingModel: deps.embedder.id,
        },
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  });

  logger.info("document.processed", {
    documentId,
    fileType: doc.fileType,
    pages: extraction.pageCount,
    segments: segmentRows.length,
    chunks: chunkRows.length,
    ms: Date.now() - startedAt,
  });
}

async function setStatus(
  db: Database,
  documentId: string,
  status: "PROCESSING" | "INDEXING" | "FAILED",
  extra: Partial<typeof documents.$inferInsert> = {},
): Promise<void> {
  await db
    .update(documents)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(documents.id, documentId));
}

/** Called by the worker once a processing job has failed permanently. */
export async function markDocumentFailed(db: Database, documentId: string, userMessage: string): Promise<void> {
  await setStatus(db, documentId, "FAILED", { errorMessage: userMessage });
}

/** Called by the worker when a transient failure will be retried. */
export async function markDocumentRetrying(db: Database, documentId: string, attempt: number, max: number): Promise<void> {
  await db
    .update(documents)
    .set({
      status: "PROCESSING",
      errorMessage: `A temporary error occurred; retrying automatically (attempt ${attempt + 1} of ${max}).`,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId));
}
