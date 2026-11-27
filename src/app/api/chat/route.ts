import { createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import { requireApiUser } from "@/server/auth/session";
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit";
import { assertSameOrigin, handle, parseJson } from "@/server/http/respond";
import { startChatTurn } from "@/server/rag/chat-turn";
import { MAX_QUESTION_CHARS } from "@/server/rag/rag-service";

const chatBody = z.object({
  documentId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  text: z.string().trim().min(1, "Ask a question.").max(MAX_QUESTION_CHARS),
});

export const POST = handle("chat", async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request);
  enforceRateLimit(RATE_LIMITS.chat, user.id);
  const body = await parseJson(request, chatBody);
  const stream = await startChatTurn({
    ownerId: user.id,
    documentId: body.documentId,
    conversationId: body.conversationId,
    question: body.text,
    // Stopping in the UI aborts the request; stop the model call too instead of paying for an unseen answer.
    abortSignal: request.signal,
  });
  return createUIMessageStreamResponse({ stream });
});
