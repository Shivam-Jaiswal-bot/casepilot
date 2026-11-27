import { createUIMessageStream, generateId, toUIMessageStream, type ToolSet } from "ai";
import type { CasePilotUIMessage } from "@/lib/chat-types";
import { getModel } from "@/server/ai/models";
import {
  appendMessage,
  createConversation,
  getConversation,
  listMessages,
} from "@/server/conversations/conversation-service";
import { getDocument } from "@/server/documents/document-service";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";
import { validateAnswer } from "./citations";
import { abstentionResult, prepareAnswer, streamGroundedAnswer, type HistoryTurn } from "./rag-service";

export interface ChatTurnInput {
  ownerId: string;
  documentId: string;
  conversationId?: string;
  question: string;
  /** Aborted when the client stops the response (request signal). */
  abortSignal?: AbortSignal;
}

const HISTORY_TURNS = 6;

/**
 * Runs one chat turn and returns a UI message stream:
 *   start → (status) → text deltas → data-citations → finish
 *
 * Authorisation and preconditions are checked BEFORE the stream opens, so
 * they surface as proper HTTP errors rather than mid-stream failures.
 */
export async function startChatTurn(input: ChatTurnInput): Promise<ReadableStream> {
  const doc = await getDocument(input.ownerId, input.documentId);
  if (doc.status !== "COMPLETED") {
    throw new AppError("CONFLICT", "This document is still being processed. Try again once indexing has completed.");
  }
  const model = getModel("primary"); // throws NOT_CONFIGURED early if no API key

  const conversation = input.conversationId
    ? await getConversation(input.ownerId, input.conversationId)
    : await createConversation(input.ownerId, doc.id, input.question);
  if (conversation.documentId && conversation.documentId !== doc.id) {
    throw new AppError("BAD_REQUEST", "This conversation belongs to a different document.");
  }

  const history: HistoryTurn[] = (await listMessages(input.ownerId, conversation.id))
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));

  await appendMessage({ ownerId: input.ownerId, conversationId: conversation.id, role: "user", content: input.question });

  const assistantId = generateId();
  const textId = generateId();

  return createUIMessageStream<CasePilotUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: assistantId });
      writer.write({ type: "data-conversation", data: { id: conversation.id }, transient: true });
      writer.write({ type: "data-status", data: { stage: "retrieving" }, transient: true });

      const prepared = await prepareAnswer(
        { ownerId: input.ownerId, question: input.question, documentIds: [doc.id], history },
        { model: getModel("utility") },
      );

      if (prepared.sources.length === 0) {
        // Nothing relevant retrieved: abstain deterministically instead of letting the model improvise.
        const { text, validation } = abstentionResult();
        writer.write({ type: "text-start", id: textId });
        writer.write({ type: "text-delta", id: textId, delta: text });
        writer.write({ type: "text-end", id: textId });
        writer.write({ type: "data-citations", id: "citations", data: validation });
        await appendMessage({
          ownerId: input.ownerId,
          conversationId: conversation.id,
          role: "assistant",
          content: text,
          validation: { invalidMarkers: [], unsupportedPageRefs: [], abstained: true },
          retrieval: prepared.trace,
        });
        writer.write({ type: "finish" });
        return;
      }

      writer.write({ type: "data-status", data: { stage: "generating" }, transient: true });
      const result = streamGroundedAnswer(input.question, history, prepared.sources, model, input.abortSignal);

      // Forward chunks sequentially (rather than writer.merge) so the citation
      // data part and the finish event are guaranteed to follow the final text.
      const uiStream = toUIMessageStream<ToolSet, CasePilotUIMessage>({
        stream: result.stream,
        sendStart: false,
        sendFinish: false,
        sendReasoning: false,
        onError: () => "The assistant failed while generating this answer.",
      });
      const reader = uiStream.getReader();
      let streamed = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.type === "text-delta") streamed += value.delta;
          writer.write(value);
        }
      } catch (err) {
        if (!input.abortSignal?.aborted) throw err;
      }

      if (input.abortSignal?.aborted) {
        // Stopped by the user: keep what was streamed (the screen may lag by the few
        // chunks already in flight), marked as partial. Generation stops with the request.
        if (streamed.trim()) {
          const partial = validateAnswer(streamed, prepared.sources);
          await appendMessage({
            ownerId: input.ownerId,
            conversationId: conversation.id,
            role: "assistant",
            content: streamed,
            citations: partial.citations,
            validation: { invalidMarkers: partial.invalidMarkers, unsupportedPageRefs: partial.unsupportedPageRefs, abstained: false, interrupted: true },
            retrieval: prepared.trace,
          });
        }
        logger.info("chat.interrupted", { conversationId: conversation.id, chars: streamed.length });
        return;
      }

      const text = await result.text;
      if (!text.trim()) {
        throw new AppError("INTERNAL", "The model returned an empty answer.");
      }
      const validation = validateAnswer(text, prepared.sources);
      writer.write({ type: "data-citations", id: "citations", data: validation });

      await appendMessage({
        ownerId: input.ownerId,
        conversationId: conversation.id,
        role: "assistant",
        content: text,
        citations: validation.citations,
        validation: {
          invalidMarkers: validation.invalidMarkers,
          unsupportedPageRefs: validation.unsupportedPageRefs,
          abstained: false,
        },
        retrieval: prepared.trace,
      });
      logger.info("chat.answered", {
        conversationId: conversation.id,
        model: model.label,
        sources: prepared.sources.length,
        citations: validation.citations.length,
        invalidMarkers: validation.invalidMarkers.length,
        coverage: validation.citationCoverage,
      });
      writer.write({ type: "finish" });
    },
    onError: (err) => {
      logger.error("chat.turn_failed", { conversationId: conversation.id, error: err });
      return err instanceof AppError ? err.message : "Something went wrong while answering. Please try again.";
    },
  });
}
