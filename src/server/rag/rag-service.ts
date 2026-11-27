import { generateText, streamText, type ModelMessage } from "ai";
import type { AnswerValidation } from "@/lib/chat-types";
import { getModel, type ModelHandle } from "@/server/ai/models";
import { logger } from "@/server/logging/logger";
import { retrieve, type RetrievalDeps } from "@/server/retrieval/retrieval-service";
import type { FusedCandidate } from "@/server/retrieval/ranking";
import type { RetrievalTrace } from "@/server/db/schema";
import { stripMarkers, validateAnswer, type ValidatableSource } from "./citations";
import {
  ABSTENTION_MESSAGE,
  buildCondenseTurn,
  buildGroundedUserTurn,
  CONDENSE_INSTRUCTIONS,
  GROUNDED_ANSWER_INSTRUCTIONS,
} from "./prompts";

/**
 * RAG orchestration, independent of HTTP:
 *   question → (follow-up rewriting) → hybrid retrieval → context → grounded
 *   generation → citation validation.
 * The chat route and the evaluation harness both use these functions.
 */

export const MAX_QUESTION_CHARS = 2000;

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PreparedAnswer {
  searchQuery: string;
  sources: ValidatableSource[];
  trace: RetrievalTrace;
}

function toSources(chunks: FusedCandidate[]): ValidatableSource[] {
  return chunks.map((c, i) => ({
    id: `S${i + 1}`,
    chunkId: c.chunkId,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    sectionTitle: c.sectionTitle,
    content: c.content,
  }));
}

/**
 * Rewrites a follow-up ("what about for cause?") into a standalone query so
 * retrieval sees the full intent. Falls back to concatenating the previous
 * user question if the model call fails – retrieval must not depend on it.
 */
export async function condenseQuestion(question: string, history: HistoryTurn[], handle?: ModelHandle): Promise<string> {
  if (history.length === 0) return question;
  const lastUser = [...history].reverse().find((h) => h.role === "user")?.content ?? "";
  try {
    // The utility handle already carries low-effort provider options.
    const model = handle ?? getModel("utility");
    const { text } = await generateText({
      model: model.model,
      instructions: CONDENSE_INSTRUCTIONS,
      prompt: buildCondenseTurn(history.map((h) => ({ ...h, content: stripMarkers(h.content) })), question),
      maxOutputTokens: 1024,
      providerOptions: model.providerOptions,
      maxRetries: 1,
    });
    const rewritten = text.split("\n").map((l) => l.trim()).find(Boolean);
    return rewritten && rewritten.length <= MAX_QUESTION_CHARS ? rewritten : `${lastUser} ${question}`;
  } catch (err) {
    logger.warn("rag.condense_failed", { error: err });
    return `${lastUser} ${question}`.trim();
  }
}

export async function prepareAnswer(
  input: { ownerId: string; question: string; documentIds?: string[]; history: HistoryTurn[] },
  opts: { model?: ModelHandle; retrievalDeps?: RetrievalDeps; topK?: number } = {},
): Promise<PreparedAnswer> {
  const searchQuery = await condenseQuestion(input.question, input.history, opts.model);
  // Search with both the rewritten query and the literal question: the literal
  // phrasing often contains exact clause names the rewrite may paraphrase away.
  const queries = searchQuery === input.question ? [input.question] : [searchQuery, input.question];
  const result = await retrieve(
    { ownerId: input.ownerId, queries, documentIds: input.documentIds, topK: opts.topK },
    opts.retrievalDeps,
  );
  return {
    searchQuery,
    sources: toSources(result.chunks),
    trace: {
      query: searchQuery,
      chunks: result.chunks.map((c) => ({ chunkId: c.chunkId, score: c.score, vectorRank: c.vectorRank, textRank: c.textRank })),
    },
  };
}

export function buildAnswerMessages(question: string, history: HistoryTurn[], sources: ValidatableSource[]): ModelMessage[] {
  const prior: ModelMessage[] = history.slice(-6).map((h) => ({
    role: h.role,
    // Old answers cite old source ids; strip markers so they can't be confused with the new sources.
    content: h.role === "assistant" ? stripMarkers(h.content) : h.content,
  }));
  return [...prior, { role: "user", content: buildGroundedUserTurn(question, sources) }];
}

export function streamGroundedAnswer(question: string, history: HistoryTurn[], sources: ValidatableSource[], handle?: ModelHandle, abortSignal?: AbortSignal) {
  const model = handle ?? getModel("primary");
  return streamText({
    abortSignal,
    model: model.model,
    instructions: GROUNDED_ANSWER_INSTRUCTIONS,
    messages: buildAnswerMessages(question, history, sources),
    maxOutputTokens: model.maxOutputTokens,
    providerOptions: model.providerOptions,
    maxRetries: 2,
  });
}

export function abstentionResult(): { text: string; validation: AnswerValidation } {
  return {
    text: ABSTENTION_MESSAGE,
    validation: { citations: [], invalidMarkers: [], unsupportedPageRefs: [], abstained: true, citationCoverage: 1 },
  };
}

/** Non-streaming variant (used by the evaluation harness and tests). */
export async function answerQuestion(
  input: { ownerId: string; question: string; documentIds?: string[]; history?: HistoryTurn[] },
  opts: { model?: ModelHandle; retrievalDeps?: RetrievalDeps; topK?: number } = {},
): Promise<{ text: string; validation: AnswerValidation; prepared: PreparedAnswer }> {
  const history = input.history ?? [];
  const prepared = await prepareAnswer({ ...input, history }, opts);
  if (prepared.sources.length === 0) return { ...abstentionResult(), prepared };
  const model = opts.model ?? getModel("primary");
  const { text } = await generateText({
    model: model.model,
    instructions: GROUNDED_ANSWER_INSTRUCTIONS,
    messages: buildAnswerMessages(input.question, history, prepared.sources),
    maxOutputTokens: model.maxOutputTokens,
    providerOptions: model.providerOptions,
  });
  return { text, validation: validateAnswer(text, prepared.sources), prepared };
}
