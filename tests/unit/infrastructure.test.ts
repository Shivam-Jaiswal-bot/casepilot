import { describe, expect, it } from "vitest";
import { LocalHashEmbedder } from "@/server/ai/embeddings";
import { resolveModelId } from "@/server/ai/models";
import { parseEnv } from "@/server/config/env";
import { toPipelineError } from "@/server/errors";
import { checkRateLimit } from "@/server/http/rate-limit";
import { backoffMs } from "@/server/jobs/job-queue";
import { redact } from "@/server/logging/logger";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", BETTER_AUTH_SECRET: "x".repeat(32) };

describe("configuration", () => {
  it("applies defaults", () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({ LLM_PROVIDER: "deepseek", EMBEDDING_DIMENSIONS: 1536, WORKER_IN_PROCESS: true });
    expect(env.LLM_MODEL).toBeUndefined();
  });

  it("resolves per-provider default models and honours explicit overrides", () => {
    expect(resolveModelId(parseEnv(base), "primary")).toBe("deepseek-v4-pro");
    expect(resolveModelId(parseEnv(base), "utility")).toBe("deepseek-flash");
    expect(resolveModelId(parseEnv({ ...base, LLM_PROVIDER: "anthropic" }), "primary")).toBe("claude-opus-5-5");
    const custom = parseEnv({ ...base, LLM_MODEL: "deepseek-flash" });
    expect(resolveModelId(custom, "utility")).toBe("deepseek-flash");
    expect(() => resolveModelId(parseEnv({ ...base, LLM_PROVIDER: "openai" }), "primary")).toThrow(/LLM_MODEL must be set/);
  });

  it("rejects embedding dimensions that don't match the vector column", () => {
    expect(() => parseEnv({ ...base, EMBEDDING_DIMENSIONS: "3072" })).toThrow(/vector column size/);
  });

  it("refuses the local-hash embedder in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", EMBEDDING_PROVIDER: "local-hash" })).toThrow(/development\/testing only/);
  });

  it("rejects inconsistent chunk settings", () => {
    expect(() => parseEnv({ ...base, CHUNK_TARGET_TOKENS: "900", CHUNK_MAX_TOKENS: "500" })).toThrow(/must not exceed/);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit within a window and reports retry-after", () => {
    const rule = { name: `t-${Math.random()}`, limit: 2, windowMs: 1000 };
    expect(checkRateLimit(rule, "u", 0).allowed).toBe(true);
    expect(checkRateLimit(rule, "u", 100).allowed).toBe(true);
    const blocked = checkRateLimit(rule, "u", 200);
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 800 });
    expect(checkRateLimit(rule, "u", 1001).allowed).toBe(true); // window slid past the first hit
    expect(checkRateLimit(rule, "other-user", 200).allowed).toBe(true);
  });
});

describe("job retry policy", () => {
  it("backs off exponentially with a cap", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([10_000, 20_000, 40_000]);
    expect(backoffMs(20)).toBe(600_000);
  });

  it("classifies transient vs permanent failures", () => {
    expect(toPipelineError(new Error("fetch failed: ECONNRESET")).retryable).toBe(true);
    expect(toPipelineError(new Error("429 Too Many Requests")).retryable).toBe(true);
    expect(toPipelineError(new Error("Cannot read properties of undefined")).retryable).toBe(false);
  });
});

describe("logging", () => {
  it("redacts sensitive keys and truncates long strings", () => {
    const out = redact({ documentId: "d1", content: "secret clause", nested: { apiKey: "sk-123" }, long: "a".repeat(400) }) as Record<string, unknown>;
    expect(out.content).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect(String(out.long)).toMatch(/truncated/);
    expect(out.documentId).toBe("d1");
  });
});

describe("LocalHashEmbedder", () => {
  it("is deterministic, normalised and reflects lexical overlap", async () => {
    const e = new LocalHashEmbedder(1536);
    const [a, b, c] = await e.embedDocuments([
      "termination for convenience on notice",
      "terminate for convenience with notice",
      "governing law of delaware",
    ]);
    const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(cos(a, a)).toBeCloseTo(1, 6);
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
    expect(await e.embedQuery("termination for convenience on notice")).toEqual(a);
  });
});

describe("DeepSeek model handle", () => {
  it("uses the Responses API model with mapped reasoning effort, and low effort for utility calls", async () => {
    const { resetEnvCache } = await import("@/server/config/env");
    const { getModel } = await import("@/server/ai/models");
    const saved = { ...process.env };
    Object.assign(process.env, { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test-key-not-real", LLM_EFFORT: "medium", LLM_MODEL: "" });
    resetEnvCache();
    try {
      const primary = getModel("primary");
      expect(primary.label).toBe("deepseek:deepseek-v4-pro");
      expect(primary.providerOptions).toEqual({ deepseek: { reasoningEffort: "high" } });
      const utility = getModel("utility");
      expect(utility.label).toBe("deepseek:deepseek-flash");
      expect(utility.providerOptions).toEqual({ deepseek: { reasoningEffort: "low" } });
    } finally {
      process.env = saved;
      resetEnvCache();
    }
  });

  it("reports a missing DeepSeek key as NOT_CONFIGURED", async () => {
    const { resetEnvCache } = await import("@/server/config/env");
    const { getModel } = await import("@/server/ai/models");
    const saved = { ...process.env };
    Object.assign(process.env, { LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "" });
    resetEnvCache();
    try {
      expect(() => getModel("primary")).toThrow(/DEEPSEEK_API_KEY is missing/);
    } finally {
      process.env = saved;
      resetEnvCache();
    }
  });
});
