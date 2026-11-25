/**
 * Standalone background worker: `npm run worker`.
 * Use this in production (with WORKER_IN_PROCESS=false on the web servers) so
 * long-running extraction, embedding and analysis never compete with requests.
 */
import "dotenv/config";
import { closeDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { startWorker } from "@/server/jobs/worker";

getEnv(); // fail fast on invalid configuration
const worker = startWorker();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  // Signals can arrive twice (e.g. forwarded by a process wrapper); shut down once.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; finishing in-flight jobs…`);
  await worker.stop();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
