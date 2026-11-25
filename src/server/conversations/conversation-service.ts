import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { AnswerValidation, CasePilotUIMessage } from "@/lib/chat-types";
import type { Citation } from "@/lib/domain";
import { getDb, type Database } from "@/server/db/client";
import { conversations, messages, type RetrievalTrace } from "@/server/db/schema";
import { notFound } from "@/server/errors";
import { isUuid } from "@/server/documents/document-service";

export type ConversationRecord = typeof conversations.$inferSelect;
export type MessageRecord = typeof messages.$inferSelect;

export async function createConversation(
  ownerId: string,
  documentId: string | null,
  firstQuestion: string,
  db: Database = getDb(),
): Promise<ConversationRecord> {
  const title = firstQuestion.replace(/\s+/g, " ").trim().slice(0, 80) || "New conversation";
  const [row] = await db.insert(conversations).values({ ownerId, documentId, title }).returning();
  return row;
}

export async function getConversation(ownerId: string, conversationId: string, db: Database = getDb()): Promise<ConversationRecord> {
  if (!isUuid(conversationId)) throw notFound("Conversation");
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, ownerId)));
  if (!row) throw notFound("Conversation");
  return row;
}

export async function listConversations(ownerId: string, documentId: string | null, db: Database = getDb()) {
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerId, ownerId),
        documentId ? eq(conversations.documentId, documentId) : isNull(conversations.documentId),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(50);
}

export async function listMessages(ownerId: string, conversationId: string, db: Database = getDb()): Promise<MessageRecord[]> {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.ownerId, ownerId)))
    .orderBy(asc(messages.createdAt));
}

export async function appendMessage(
  input: {
    ownerId: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    citations?: Citation[];
    validation?: Omit<AnswerValidation, "citations" | "citationCoverage">;
    retrieval?: RetrievalTrace;
  },
  db: Database = getDb(),
): Promise<MessageRecord> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        citations: input.citations ?? [],
        validation: input.validation,
        retrieval: input.retrieval,
      })
      .returning();
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.ownerId, input.ownerId)));
    return row;
  });
}

/** Rehydrates stored messages into the UI message shape used by `useChat`. */
export function toUIMessages(rows: MessageRecord[]): CasePilotUIMessage[] {
  return rows.map((m) => {
    const parts: CasePilotUIMessage["parts"] = [{ type: "text", text: m.content }];
    if (m.role === "assistant") {
      parts.push({
        type: "data-citations",
        data: {
          citations: m.citations,
          invalidMarkers: m.validation?.invalidMarkers ?? [],
          unsupportedPageRefs: m.validation?.unsupportedPageRefs ?? [],
          abstained: m.validation?.abstained ?? false,
          citationCoverage: 0,
        },
      });
    }
    return { id: m.id, role: m.role, parts };
  });
}
