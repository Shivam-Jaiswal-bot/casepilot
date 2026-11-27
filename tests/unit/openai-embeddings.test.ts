import { afterEach, describe, expect, it } from "vitest";
import { getEmbedder, resetEmbedderCache } from "@/server/ai/embeddings";
import { setProviderFetch } from "@/server/ai/models";
import { resetEnvCache } from "@/server/config/env";

/**
 * Contract test for the OpenAI embedder: the exact request body sent by the real
 * @ai-sdk/openai provider, and the dimension guard. No network access.
 */
const saved = { ...process.env };

function useOpenAiEmbedder(respondDims: number) {
  const requests: { url: string; body: { model: string; input: string[]; dimensions?: number; encoding_format?: string } }[] = [];
  setProviderFetch(async (input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(input), body });
    return Response.json({
      object: "list",
      data: body.input.map((_: string, index: number) => ({ object: "embedding", index, embedding: new Array(respondDims).fill(0.01) })),
      model: body.model,
      usage: { prompt_tokens: 8, total_tokens: 8 },
    });
  });
  Object.assign(process.env, { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "test-key-not-real", EMBEDDING_MODEL: "text-embedding-3-small", EMBEDDING_DIMENSIONS: "1536" });
  resetEnvCache();
  resetEmbedderCache();
  return requests;
}

afterEach(() => {
  setProviderFetch(undefined);
  process.env = { ...saved };
  resetEnvCache();
  resetEmbedderCache();
});

describe("OpenAI embedder (text-embedding-3-small)", () => {
  it("sends documents and queries to the same model with explicit 1536 dimensions", async () => {
    const requests = useOpenAiEmbedder(1536);
    const embedder = getEmbedder();
    expect(embedder.id).toBe("openai:text-embedding-3-small@1536");
    const docs = await embedder.embedDocuments(["clause one", "clause two"]);
    const query = await embedder.embedQuery("termination notice");
    expect(docs).toHaveLength(2);
    expect(query).toHaveLength(1536);
    expect(requests.map((r) => r.body.model)).toEqual(["text-embedding-3-small", "text-embedding-3-small"]);
    expect(requests.every((r) => r.body.dimensions === 1536)).toBe(true);
    expect(new URL(requests[0].url).pathname).toBe("/v1/embeddings");
  });

  it("rejects vectors whose dimension does not match the pgvector column", async () => {
    useOpenAiEmbedder(3072);
    await expect(getEmbedder().embedQuery("termination")).rejects.toThrow(/3072 dimensions; expected 1536/);
  });

  it("is never the LLM: the embedding model is configured independently of LLM_MODEL", async () => {
    useOpenAiEmbedder(1536);
    Object.assign(process.env, { LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-luna" });
    resetEnvCache();
    resetEmbedderCache();
    expect(getEmbedder().id).toBe("openai:text-embedding-3-small@1536");
  });
});
