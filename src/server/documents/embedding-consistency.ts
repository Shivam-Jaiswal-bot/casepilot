import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { getEnv } from "@/server/config/env";
import { enqueueJob } from "@/server/jobs/job-queue";

/**
 * Embedding-model consistency.
 *
 * Every chunk records the embedder that produced its vector
 * (`metadata.embeddingModel`, e.g. "openai:text-embedding-3-small@1536").
 * Query embeddings must come from the same model and dimensions, so after an
 * embedding-model change only documents with mismatched chunks need
 * re-embedding — documents already on the current model are left untouched.
 */
export interface StaleDocument {
  id: string;
  ownerId: string;
  title: string;
  embeddingModels: string[];
}

export async function findStaleDocuments(db: Database, currentEmbedderId: string): Promise<StaleDocument[]> {
  const rows = await db.execute(sql`
    select d.id, d.owner_id, d.title,
           array_agg(distinct coalesce(c.metadata->>'embeddingModel', 'unknown')) as models
    from documents d
    join document_chunks c on c.document_id = d.id
    where d.status = 'COMPLETED'
    group by d.id, d.owner_id, d.title
    having bool_or(coalesce(c.metadata->>'embeddingModel', '') <> ${currentEmbedderId})
    order by d.title
  `);
  return (rows as unknown as { id: string; owner_id: string; title: string; models: string[] }[]).map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    embeddingModels: r.models,
  }));
}

/** Re-queues processing for the given stale documents. Returns how many were queued. */
export async function requeueForReembedding(db: Database, stale: StaleDocument[]): Promise<number> {
  let queued = 0;
  for (const doc of stale) {
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ status: "UPLOADED", errorMessage: null, updatedAt: new Date() })
        .where(and(eq(documents.id, doc.id), eq(documents.ownerId, doc.ownerId)));
      await enqueueJob(tx, { type: "PROCESS_DOCUMENT", ownerId: doc.ownerId, documentId: doc.id, maxAttempts: getEnv().JOB_MAX_ATTEMPTS });
    });
    queued++;
  }
  return queued;
}
