import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { EMBEDDING_COLUMN_DIMENSIONS, getEnv } from "@/server/config/env";
import { AppError } from "@/server/errors";

/**
 * Embedding abstraction. Documents and queries are embedded through the same
 * Embedder so vectors always live in the same space.
 */
export interface Embedder {
  /** Stable identifier stored with each chunk ("openai:text-embedding-3-small@1536"). */
  readonly id: string;
  readonly dimensions: number;
  embedDocuments(values: string[]): Promise<number[][]>;
  embedQuery(value: string): Promise<number[]>;
}

class AiSdkOpenAIEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  private readonly model;
  private readonly batchSize: number;

  constructor(apiKey: string, modelId: string, dimensions: number, batchSize: number) {
    this.model = createOpenAI({ apiKey }).embeddingModel(modelId);
    this.dimensions = dimensions;
    this.batchSize = batchSize;
    this.id = `openai:${modelId}@${dimensions}`;
  }

  async embedDocuments(values: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < values.length; i += this.batchSize) {
      const { embeddings } = await embedMany({
        model: this.model,
        values: values.slice(i, i + this.batchSize),
        dimensions: this.dimensions,
        maxRetries: 3,
      });
      out.push(...embeddings);
    }
    return out.map((v) => assertDimensions(v, this.dimensions));
  }

  async embedQuery(value: string): Promise<number[]> {
    const { embedding } = await embed({ model: this.model, value, dimensions: this.dimensions, maxRetries: 3 });
    return assertDimensions(embedding, this.dimensions);
  }
}

/**
 * Deterministic "feature hashing" embedder for tests and offline development.
 *
 * Each token (and token bigram) is hashed into one of N buckets with a ±1
 * sign; the vector is L2-normalised. Cosine similarity then approximates
 * lexical overlap. It has NO semantic understanding (synonyms will not match)
 * and is rejected by config validation in production.
 */
export class LocalHashEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;

  constructor(dimensions = EMBEDDING_COLUMN_DIMENSIONS) {
    this.dimensions = dimensions;
    this.id = `local-hash@${dimensions}`;
  }

  private vectorize(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
      .map(stem);
    const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)];
    for (const feature of features) {
      const h = createHash("md5").update(feature).digest();
      const bucket = h.readUInt32LE(0) % this.dimensions;
      vec[bucket] += h[4] & 1 ? 1 : -1;
    }
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
    // pgvector cannot compute cosine distance for a zero vector; use a tiny constant direction instead.
    if (norm === 0) {
      vec[0] = 1;
      return vec;
    }
    return vec.map((x) => x / norm);
  }

  async embedDocuments(values: string[]): Promise<number[][]> {
    return values.map((v) => this.vectorize(v));
  }

  async embedQuery(value: string): Promise<number[]> {
    return this.vectorize(value);
  }
}

const STOPWORDS = new Set(
  "the and for are but not you all any can her was one our out has have had its into than then them they this that with from shall will such which there their what when where who whom been being does may upon each other under".split(
    " ",
  ),
);

/** Crude suffix stripping so "terminate"/"termination"/"terminated" share a feature. */
function stem(token: string): string {
  return token.replace(/(ations?|ated|ating|ates|ate|ions?|ing|ed|es|s)$/, "") || token;
}

function assertDimensions(v: number[], expected: number): number[] {
  if (v.length !== expected) {
    throw new AppError("INTERNAL", `Embedding has ${v.length} dimensions; expected ${expected}.`);
  }
  return v;
}

let override: Embedder | undefined;
let cached: Embedder | undefined;

export function setEmbedderOverride(embedder: Embedder | undefined): void {
  override = embedder;
}

export function getEmbedder(): Embedder {
  if (override) return override;
  if (cached) return cached;
  const env = getEnv();
  if (env.EMBEDDING_PROVIDER === "local-hash") {
    cached = new LocalHashEmbedder(env.EMBEDDING_DIMENSIONS);
    return cached;
  }
  if (!env.OPENAI_API_KEY) {
    throw new AppError(
      "NOT_CONFIGURED",
      "Document indexing is not configured: OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai.",
    );
  }
  cached = new AiSdkOpenAIEmbedder(env.OPENAI_API_KEY, env.EMBEDDING_MODEL, env.EMBEDDING_DIMENSIONS, env.EMBEDDING_BATCH_SIZE);
  return cached;
}
