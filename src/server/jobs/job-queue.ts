import { and, eq, lt, sql } from "drizzle-orm";
import type { JobType } from "@/lib/domain";
import type { Database } from "@/server/db/client";
import { processingJobs } from "@/server/db/schema";
import type { PipelineError } from "@/server/errors";

/**
 * Postgres-backed job queue.
 *
 * Why not Redis/BullMQ? The project already depends on Postgres, job volume is
 * modest (one job per upload/analysis), and keeping jobs in the same database
 * lets us enqueue a job in the SAME transaction that creates the document –
 * there is no window in which a document exists without its job.
 *
 * Concurrency safety comes from `FOR UPDATE SKIP LOCKED`: several workers can
 * poll simultaneously and each row is claimed by exactly one of them.
 */

export type Job = typeof processingJobs.$inferSelect;

type Executor = Pick<Database, "insert" | "update" | "execute" | "select">;

export async function enqueueJob(
  db: Executor,
  input: { type: JobType; ownerId: string; documentId: string; analysisId?: string; maxAttempts: number },
): Promise<void> {
  // The partial unique index (one active job per document/type/analysis) makes
  // duplicate enqueues a no-op instead of creating competing jobs.
  await db
    .insert(processingJobs)
    .values({
      type: input.type,
      ownerId: input.ownerId,
      documentId: input.documentId,
      analysisId: input.analysisId ?? null,
      maxAttempts: input.maxAttempts,
    })
    .onConflictDoNothing();
}

/** Atomically claims the oldest runnable job, or returns null when the queue is empty. */
export async function claimNextJob(db: Database, workerId: string): Promise<Job | null> {
  const claimed = await db
    .update(processingJobs)
    .set({
      status: "RUNNING",
      lockedAt: sql`now()`,
      lockedBy: workerId,
      attempts: sql`${processingJobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      eq(
        processingJobs.id,
        sql`(
          select id from processing_jobs
          where status = 'QUEUED' and run_after <= now()
          order by run_after, created_at
          for update skip locked
          limit 1
        )`,
      ),
    )
    .returning();
  return claimed[0] ?? null;
}

export async function markJobSucceeded(db: Database, jobId: string): Promise<void> {
  await db
    .update(processingJobs)
    .set({ status: "SUCCEEDED", completedAt: sql`now()`, lockedAt: null, lockedBy: null, lastError: null, updatedAt: sql`now()` })
    .where(eq(processingJobs.id, jobId));
}

/** Exponential backoff: 10s, 20s, 40s … capped at 10 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, attempt - 1), 10 * 60_000);
}

/**
 * Records a failure. Returns `true` when the job will be retried, `false` when
 * it has failed permanently (non-retryable error or attempts exhausted).
 */
export async function markJobFailed(db: Database, job: Job, error: PipelineError): Promise<boolean> {
  const willRetry = error.retryable && job.attempts < job.maxAttempts;
  await db
    .update(processingJobs)
    .set(
      willRetry
        ? {
            status: "QUEUED",
            runAfter: sql`now() + make_interval(secs => ${backoffMs(job.attempts) / 1000})`,
            lockedAt: null,
            lockedBy: null,
            lastError: `${error.code}: ${error.userMessage}`,
            updatedAt: sql`now()`,
          }
        : {
            status: "FAILED",
            completedAt: sql`now()`,
            lockedAt: null,
            lockedBy: null,
            lastError: `${error.code}: ${error.userMessage}`,
            updatedAt: sql`now()`,
          },
    )
    .where(eq(processingJobs.id, job.id));
  return willRetry;
}

/**
 * Returns RUNNING jobs whose worker died (process crash, deploy) to the queue.
 * Handlers are idempotent, so re-running a half-finished job is safe.
 */
export async function requeueStaleJobs(db: Database, staleAfterMs: number): Promise<number> {
  const rows = await db
    .update(processingJobs)
    .set({ status: "QUEUED", lockedAt: null, lockedBy: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(processingJobs.status, "RUNNING"),
        lt(processingJobs.lockedAt, sql`now() - make_interval(secs => ${staleAfterMs / 1000})`),
      ),
    )
    .returning({ id: processingJobs.id });
  return rows.length;
}
