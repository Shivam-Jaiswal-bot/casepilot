import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setModelOverride, setProviderFetch } from "@/server/ai/models";
import { resetEnvCache } from "@/server/config/env";
import { uploadDocument } from "@/server/documents/document-service";
import { drainQueue } from "@/server/jobs/worker";
import { startChatTurn } from "@/server/rag/chat-turn";
import { answerQuestion } from "@/server/rag/rag-service";
import { getAnalysis, startRiskAnalysis } from "@/server/risk/risk-service";
import { createUser, resetDatabase } from "../support/db";
import { createFakeResponsesApi, strictSchemaViolations } from "../support/fake-responses-api";
import { buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";
import { reviewer } from "../support/risk-reviewer";

/**
 * Provider contract tests: the REAL @ai-sdk/openai and @ai-sdk/deepseek
 * providers run against a fake Responses API that speaks their wire format.
 * This verifies request shape (model, strict JSON schema, reasoning effort,
 * data retention) and that CasePilot's citation validation and evidence
 * verification work on responses parsed by each provider — without API keys.
 * It does NOT measure model quality; see `npm run eval`.
 */

const PROVIDERS = [
  { provider: "openai", keyVar: "OPENAI_API_KEY", model: "gpt-6-luna", host: "api.openai.com" },
  { provider: "deepseek", keyVar: "DEEPSEEK_API_KEY", model: "deepseek-v4-pro", host: "api.deepseek.com" },
] as const;

const chatResponder = (prompt: string) => {
  if (prompt.includes("Standalone search query")) return "provider termination for convenience notice period";
  return "The Provider may terminate on ten (10) days' written notice [S1, S2]. A cure period also applies [S9].";
};

describe.each(PROVIDERS)("$provider ($model) provider contract", ({ provider, keyVar, model, host }) => {
  const saved = { ...process.env };
  let owner: string;
  let documentId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUser(`contract-${provider}`);
    documentId = (await uploadDocument(owner, { filename: "acme.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) })).id;
    await drainQueue();
    Object.assign(process.env, { LLM_PROVIDER: provider, [keyVar]: "test-key-not-real", LLM_MODEL: "", LLM_UTILITY_MODEL: "", LLM_EFFORT: "medium" });
    resetEnvCache();
    setModelOverride({});
  });

  afterEach(() => {
    setProviderFetch(undefined);
    process.env = { ...saved };
    resetEnvCache();
  });

  it("risk analysis: strict structured-output requests parse into verified, located findings", async () => {
    const api = createFakeResponsesApi((prompt, req) => (req.structured ? reviewer(prompt) : "unexpected"), model);
    setProviderFetch(api.fetch);

    const started = await startRiskAnalysis(owner, documentId, "We are the Customer");
    await drainQueue();
    const { analysis, findings } = await getAnalysis(owner, started.id);

    expect(analysis.status).toBe("COMPLETED");
    expect(analysis.model).toBe(`${provider}:${model}`);
    expect(analysis.profile?.contractType).toBe("Master Services Agreement");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "TERMINATION", severity: "HIGH" });
    expect(findings[0].evidence[0]).toMatchObject({ pageStart: 2, match: "EXACT" });
    const coverage = Object.fromEntries(analysis.categoryCoverage.map((c) => [c.category, c]));
    expect(coverage.INDEMNIFICATION.outcome).toBe("NOT_IDENTIFIED"); // fabricated quote rejected for this provider too
    expect(coverage.PAYMENT.outcome).not.toBe("ERROR");

    const structured = api.requests.filter((r) => (r.body.text as { format?: { type?: string } })?.format?.type === "json_schema");
    expect(structured.length).toBeGreaterThanOrEqual(2);
    for (const r of api.requests) {
      expect(new URL(r.url).host).toBe(host);
      expect(r.body.model).toBe(model);
    }
    const format = (structured[0].body.text as { format: { strict?: boolean; schema: unknown } }).format;
    // OpenAI enforces the schema server-side (strict). DeepSeek's Responses model sends the
    // schema without `strict` (its strictJsonSchema option only exists for Chat Completions),
    // so malformed output is caught client-side by Zod and recorded as a category ERROR.
    if (provider === "openai") expect(format.strict).toBe(true);
    else expect(format.strict).toBeUndefined();
    // Every schema we send must satisfy strict-mode rules (all properties required, closed objects).
    for (const r of structured) {
      expect(strictSchemaViolations((r.body.text as { format: { schema: unknown } }).format.schema)).toEqual([]);
    }
    if (provider === "openai") {
      expect(structured[0].body.store).toBe(false);
      expect(structured[0].body.reasoning).toMatchObject({ effort: "medium" });
      expect(structured[0].body).not.toHaveProperty("temperature");
    }
  });

  it("grounded answers: grouped citation markers resolve and unknown markers are flagged", async () => {
    const api = createFakeResponsesApi(chatResponder, model);
    setProviderFetch(api.fetch);
    const { validation } = await answerQuestion({ ownerId: owner, question: "Can the provider terminate for convenience?", documentIds: [documentId] });
    expect(validation.citations.map((c) => c.sourceId)).toEqual(["S1", "S2"]);
    expect(validation.invalidMarkers).toEqual(["S9"]);
    expect(validation.citations[0].documentId).toBe(documentId);
    // Document text reaches the provider only inside <source> elements of the user turn.
    const prompt = JSON.stringify(api.requests.at(-1)!.body.input);
    expect(prompt).toContain("<source id=\\\"S1\\\"");
  });

  it("streaming chat: SSE responses stream through to validated citations and persistence", async () => {
    const api = createFakeResponsesApi(chatResponder, model);
    setProviderFetch(api.fetch);
    const stream = await startChatTurn({ ownerId: owner, documentId, question: "How much notice does the provider need?" });
    const parts: { type: string; delta?: string; data?: unknown }[] = [];
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);

    const text = parts.filter((p) => p.type === "text-delta").map((p) => p.delta).join("");
    expect(text).toContain("ten (10) days");
    const types = parts.map((p) => p.type);
    expect(types).not.toContain("error");
    expect(types.indexOf("data-citations")).toBeGreaterThan(types.lastIndexOf("text-delta"));
    const validation = parts.find((p) => p.type === "data-citations")!.data as { citations: unknown[]; invalidMarkers: string[] };
    expect(validation.citations).toHaveLength(2);
    expect(validation.invalidMarkers).toEqual(["S9"]);
    expect(api.requests.some((r) => r.body.stream === true)).toBe(true);
  });
});
