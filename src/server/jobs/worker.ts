import { hostname } from "node:os";
import { getEnv } from "@/server/config/env";
import { getDb, type Database } from "@/server/db/client";
import { defaultProcessingDeps, markDocumentFailed, markDocumentRetrying, processDocument } from "@/server/documents/processing";
import { toPipelineError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { defaultRiskDeps, markAnalysisFailed, runRiskAnalysis } from "@/server/risk/risk-service";
import { claimNextJob, markJobFailed, markJobSucceeded, requeueStaleJobs, type Job } from "./job-queue";

/**
 * Background worker: polls the job table and executes jobs with bounded
 * concurrency. Runs either inside the Next.js server (WORKER_IN_PROCESS=true,
 * convenient in development) or as a standalone process (`npm run worker`).
 */

export interface JobHandlers {
  processDocument: (job: Job) => Promise<void>;
  analyzeRisk: (job: Job) => Promise<void>;
}

export const defaultHandlers: JobHandlers = {
  processDocument: (job) => processDocument(job.documentId, job.ownerId, defaultProcessingDeps()),
  analyzeRisk: (job) => {
    if (!job.analysisId) throw new Error("ANALYZE_RISK job without analysisId");
    return runRiskAnalysis(job.analysisId, job.ownerId, defaultRiskDeps());
  },
};

/** Executes one claimed job and records its outcome. Never throws. */
export async function executeJob(db: Database, job: Job, handlers: JobHandlers = defaultHandlers): Promise<void> {
  const started = Date.now();
  try {
    if (job.type === "PROCESS_DOCUMENT") await handlers.processDocument(job);
    else await handlers.analyzeRisk(job);
    await markJobSucceeded(db, job.id);
    logger.info("job.succeeded", { jobId: job.id, type: job.type, attempt: job.attempts, ms: Date.now() - started });
  } catch (err) {
    const error = toPipelineError(err);
    const willRetry = await markJobFailed(db, job, error);
    logger.warn("job.failed", { jobId: job.id, type: job.type, attempt: job.attempts, code: error.code, willRetry, error: err });
    try {
      if (job.type === "PROCESS_DOCUMENT") {
        if (willRetry) await markDocumentRetrying(db, job.documentId, job.attempts, job.maxAttempts);
        else await markDocumentFailed(db, job.documentId, error.userMessage);
      } else if (job.analysisId && !willRetry) {
        await markAnalysisFailed(db, job.analysisId, error.userMessage);
      }
    } catch (statusErr) {
      // The document/analysis may have been deleted meanwhile; nothing else to update.
      logger.warn("job.status_update_failed", { jobId: job.id, error: statusErr });
    }
  }
}

/** Claims and runs jobs until the queue is empty. Returns the number processed (used by tests/eval). */
export async function drainQueue(db: Database = getDb(), handlers: JobHandlers = defaultHandlers, workerId = "drain"): Promise<number> {
  let processed = 0;
  for (;;) {
    const job = await claimNextJob(db, workerId);
    if (!job) return processed;
    await executeJob(db, job, handlers);
    processed++;
  }
}

export interface WorkerHandle {
  stop: () => Promise<void>;
}

export function startWorker(options: { concurrency?: number; pollIntervalMs?: number } = {}): WorkerHandle {
  const env = getEnv();
  const concurrency = options.concurrency ?? env.WORKER_CONCURRENCY;
  const pollMs = options.pollIntervalMs ?? env.WORKER_POLL_INTERVAL_MS;
  const db = getDb();
  const workerId = `${hostname()}:${process.pid}`;
  let stopping = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const loop = async (slot: number) => {
    while (!stopping) {
      try {
        const job = await claimNextJob(db, `${workerId}#${slot}`);
        if (job) {
          await executeJob(db, job);
          continue; // immediately look for more work
        }
      } catch (err) {
        logger.error("worker.poll_failed", { error: err });
      }
      await sleep(pollMs);
    }
  };

  const reaper = setInterval(() => {
    requeueStaleJobs(db, env.JOB_STALE_AFTER_MS)
      .then((n) => n && logger.warn("worker.requeued_stale_jobs", { count: n }))
      .catch((err: unknown) => logger.error("worker.reaper_failed", { error: err }));
  }, 60_000);
  reaper.unref?.();

  logger.info("worker.started", { workerId, concurrency, pollMs });
  const loops = Array.from({ length: concurrency }, (_, i) => loop(i));

  return {
    stop: async () => {
      stopping = true;
      clearInterval(reaper);
      await Promise.all(loops);
      logger.info("worker.stopped", { workerId });
    },
  };
}
