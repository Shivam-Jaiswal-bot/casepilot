/**
 * Starts the background job worker inside the Next.js server process when
 * WORKER_IN_PROCESS=true (the development default). In production, prefer
 * running `npm run worker` as a separate process and set WORKER_IN_PROCESS=false.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.WORKER_IN_PROCESS === "false" || process.env.WORKER_IN_PROCESS === "0") return;

  const g = globalThis as unknown as { __casepilotWorkerStarted?: boolean };
  if (g.__casepilotWorkerStarted) return; // guard against double start on dev hot reloads
  g.__casepilotWorkerStarted = true;

  const { startWorker } = await import("./server/jobs/worker");
  startWorker();
}
