import { z } from "zod";

/**
 * Centralised, validated runtime configuration.
 *
 * Config is parsed lazily (on first access) rather than at import time so that
 * `next build`, unit tests and tooling can import server modules without a full
 * production environment. Every consumer goes through `getEnv()`, so a bad value
 * fails loudly with a readable message instead of surfacing as `undefined` deep
 * inside a request.
 */

/** The pgvector column dimension baked into the database migration. */
export const EMBEDDING_COLUMN_DIMENSIONS = 1536;

const boolFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const intFromString = (def: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.string().url(),

    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

    // ---- Language model ----------------------------------------------------
    LLM_PROVIDER: z.enum(["deepseek", "anthropic", "openai"]).default("deepseek"),
    /** Primary model id. Optional: each provider has a default (see DEFAULT_MODELS in ai/models.ts). */
    LLM_MODEL: z.string().min(1).optional(),
    /** Model used for cheap utility calls (follow-up question rewriting). */
    LLM_UTILITY_MODEL: z.string().min(1).optional(),
    /** Reasoning effort. Anthropic uses it directly; DeepSeek maps it to low | high | max. */
    LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
    LLM_MAX_OUTPUT_TOKENS: intFromString(4096, 256, 64000),
    DEEPSEEK_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),

    // ---- Embeddings --------------------------------------------------------
    /**
     * `openai`     – production embeddings via the AI SDK OpenAI provider.
     * `local-hash` – deterministic lexical hashing embedder for tests and offline
     *                development ONLY. It is not a semantic model.
     */
    EMBEDDING_PROVIDER: z.enum(["openai", "local-hash"]).default("openai"),
    EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
    EMBEDDING_DIMENSIONS: intFromString(EMBEDDING_COLUMN_DIMENSIONS),
    EMBEDDING_BATCH_SIZE: intFromString(64, 1, 2048),

    // ---- Storage -----------------------------------------------------------
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default("./storage"),
    MAX_UPLOAD_MB: intFromString(25, 1, 200),

    // ---- Chunking ----------------------------------------------------------
    CHUNK_TARGET_TOKENS: intFromString(450, 100, 4000),
    CHUNK_MAX_TOKENS: intFromString(700, 150, 8000),
    CHUNK_OVERLAP_TOKENS: intFromString(60, 0, 1000),

    // ---- Retrieval ---------------------------------------------------------
    RETRIEVAL_CANDIDATES: intFromString(40, 5, 200),
    RETRIEVAL_TOP_K: intFromString(8, 1, 50),
    CONTEXT_TOKEN_BUDGET: intFromString(6000, 500, 100000),
    /** Minimum cosine similarity for a vector-only hit to be considered relevant. */
    RETRIEVAL_MIN_VECTOR_SIMILARITY: z.coerce.number().min(-1).max(1).default(0.2),

    // ---- Background jobs ---------------------------------------------------
    WORKER_IN_PROCESS: boolFromString.default(true),
    WORKER_POLL_INTERVAL_MS: intFromString(2000, 100, 60000),
    WORKER_CONCURRENCY: intFromString(2, 1, 16),
    JOB_MAX_ATTEMPTS: intFromString(3, 1, 10),
    JOB_STALE_AFTER_MS: intFromString(15 * 60 * 1000, 60000),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.CHUNK_TARGET_TOKENS > env.CHUNK_MAX_TOKENS) {
      ctx.addIssue({
        code: "custom",
        path: ["CHUNK_TARGET_TOKENS"],
        message: "CHUNK_TARGET_TOKENS must not exceed CHUNK_MAX_TOKENS",
      });
    }
    if (env.CHUNK_OVERLAP_TOKENS >= env.CHUNK_TARGET_TOKENS) {
      ctx.addIssue({
        code: "custom",
        path: ["CHUNK_OVERLAP_TOKENS"],
        message: "CHUNK_OVERLAP_TOKENS must be smaller than CHUNK_TARGET_TOKENS",
      });
    }
    if (env.EMBEDDING_DIMENSIONS !== EMBEDDING_COLUMN_DIMENSIONS) {
      ctx.addIssue({
        code: "custom",
        path: ["EMBEDDING_DIMENSIONS"],
        message: `EMBEDDING_DIMENSIONS must equal the database vector column size (${EMBEDDING_COLUMN_DIMENSIONS}). Changing it requires a new migration and re-indexing.`,
      });
    }
    if (env.NODE_ENV === "production" && env.EMBEDDING_PROVIDER === "local-hash") {
      ctx.addIssue({
        code: "custom",
        path: ["EMBEDDING_PROVIDER"],
        message: "The local-hash embedder is for development/testing only and cannot be used in production.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` in a .env file falls back to defaults.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid CasePilot configuration:\n${details}`);
  }
  return result.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper: forget the cached config so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
