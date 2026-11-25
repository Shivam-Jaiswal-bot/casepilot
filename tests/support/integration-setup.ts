import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { afterAll } from "vitest";

config({ quiet: true });

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error("TEST_DATABASE_URL must be set for integration tests (see .env.example). Start Postgres with `npm run db:up`.");
}
if (!/_test\b/.test(new URL(testDbUrl).pathname)) {
  throw new Error("Refusing to run integration tests against a database whose name does not end in _test.");
}

const storageDir = mkdtempSync(path.join(tmpdir(), "casepilot-test-storage-"));

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: testDbUrl,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "integration-test-secret-0000000000000",
  EMBEDDING_PROVIDER: "local-hash",
  STORAGE_LOCAL_DIR: storageDir,
  WORKER_IN_PROCESS: "false",
  // Small chunks so the short fixture contract yields several chunks.
  CHUNK_TARGET_TOKENS: "120",
  CHUNK_MAX_TOKENS: "200",
  CHUNK_OVERLAP_TOKENS: "25",
  RETRIEVAL_MIN_VECTOR_SIMILARITY: "0.05",
  JOB_MAX_ATTEMPTS: "3",
  LLM_PROVIDER: "deepseek",
  DEEPSEEK_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
});

afterAll(async () => {
  const { closeDb } = await import("@/server/db/client");
  await closeDb();
  rmSync(storageDir, { recursive: true, force: true });
});
