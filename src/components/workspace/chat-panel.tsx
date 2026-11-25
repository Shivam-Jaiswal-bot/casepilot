"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertTriangle, ArrowUp, MessageSquarePlus, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Disclaimer, Spinner } from "@/components/ui/primitives";
import type { AnswerValidation, CasePilotUIMessage, ChatRequestBody } from "@/lib/chat-types";
import { cn } from "@/lib/cn";
import { formatLocation, type Citation } from "@/lib/domain";
import { AnswerText } from "./answer-text";

const SUGGESTIONS = [
  "What are the major risks in this contract?",
  "Can the other party terminate without notice?",
  "What is the limitation of liability?",
  "Does this contract renew automatically?",
  "Is there an indemnification clause?",
];

function textOf(message: CasePilotUIMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function validationOf(message: CasePilotUIMessage): AnswerValidation | undefined {
  const part = message.parts.find((p) => p.type === "data-citations");
  return part?.type === "data-citations" ? part.data : undefined;
}

/** The transport surfaces non-2xx bodies verbatim; unwrap our `{ error: { message } }` envelope. */
function friendlyError(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // not JSON – fall through
  }
  return error.message || "The assistant could not answer. Please try again.";
}

export interface ConversationSummary {
  id: string;
  title: string;
}

export function ChatPanel({
  documentId,
  initialConversationId,
  initialMessages,
  conversations,
  onSelectCitation,
}: {
  documentId: string;
  initialConversationId: string | null;
  initialMessages: CasePilotUIMessage[];
  conversations: ConversationSummary[];
  onSelectCitation: (citation: Citation) => void;
}) {
  const router = useRouter();
  const conversationRef = useRef<string | null>(initialConversationId);
  const [stage, setStage] = useState<"retrieving" | "generating" | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<CasePilotUIMessage>({
        api: "/api/chat",
        // Send only the new question; the server owns conversation history.
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1];
          const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
          const request: ChatRequestBody = { documentId, conversationId, text: last ? textOf(last) : "" };
          return { body: request };
        },
      }),
    [documentId],
  );

  const { messages, sendMessage, status, error, stop, clearError } = useChat<CasePilotUIMessage>({
    id: initialConversationId ?? `new-${documentId}`,
    messages: initialMessages,
    transport,
    onData: (part) => {
      if (part.type === "data-conversation" && conversationRef.current !== part.data.id) {
        conversationRef.current = part.data.id;
        const url = new URL(window.location.href);
        url.searchParams.set("c", part.data.id);
        window.history.replaceState(window.history.state, "", url);
      }
      if (part.type === "data-status") setStage(part.data.stage);
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
    },
    onFinish: () => setStage(null),
    onError: () => setStage(null),
  });

  const busy = status === "submitted" || status === "streaming";

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    setInput("");
    // The conversation id is read here (an event handler), not during render.
    void sendMessage({ text: trimmed }, { body: { conversationId: conversationRef.current ?? undefined } });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <h2 className="text-sm font-semibold text-ink">Ask about this contract</h2>
        <div className="ml-auto flex items-center gap-1">
          {conversations.length > 0 && (
            <select
              aria-label="Previous conversations"
              className="h-7 max-w-44 truncate rounded border border-line-strong bg-surface px-2 text-xs text-ink-muted"
              value={initialConversationId ?? ""}
              onChange={(e) => router.push(`/documents/${documentId}${e.target.value ? `?c=${e.target.value}` : "?new=1"}`)}
            >
              <option value="">Conversations…</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <a href={`/documents/${documentId}?new=1`} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink" title="New conversation">
            <MessageSquarePlus className="size-3.5" aria-hidden /> New
          </a>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-6">
            <p className="text-sm text-ink-muted">Answers are drawn only from this document, with citations you can inspect. Try:</p>
            <div className="mt-3 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="rounded-md border border-line bg-surface px-3 py-2 text-left text-sm text-ink hover:border-line-strong hover:bg-surface-muted/60">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white">{textOf(m)}</div>
              </div>
            );
          }
          const validation = validationOf(m);
          const citations = validation ? new Map(validation.citations.map((c) => [c.sourceId, c])) : undefined;
          return (
            <div key={m.id} className="space-y-2">
              <AnswerText text={textOf(m)} markers={{ citations, invalid: new Set(validation?.invalidMarkers), onSelect: onSelectCitation }} />
              {validation && validation.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {validation.citations.map((c) => (
                    <button
                      key={c.sourceId}
                      onClick={() => onSelectCitation(c)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-left text-xs text-ink-muted hover:border-accent hover:text-accent"
                    >
                      <span className="font-mono font-semibold text-accent">{c.sourceId}</span>
                      <span className="truncate">{formatLocation(c)}</span>
                    </button>
                  ))}
                </div>
              )}
              {validation && (validation.invalidMarkers.length > 0 || validation.unsupportedPageRefs.length > 0) && (
                <div className="flex items-start gap-1.5 text-xs text-danger">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {validation.invalidMarkers.length > 0 && `Unverified citation(s) ${validation.invalidMarkers.join(", ")} did not match retrieved evidence. `}
                    {validation.unsupportedPageRefs.length > 0 && `Page reference(s) ${validation.unsupportedPageRefs.join(", ")} are not in the cited sources — verify manually.`}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <Spinner />
            {stage === "generating" ? "Drafting a grounded answer…" : "Searching the document…"}
          </div>
        )}
        {error && <Alert kind="error">{friendlyError(error)}</Alert>}
      </div>

      <form onSubmit={onSubmit} className="border-t border-line p-3">
        <div className={cn("flex items-end gap-2 rounded-lg border border-line-strong bg-surface p-2 shadow-(--shadow-card) focus-within:border-focus")}>
          <label className="sr-only" htmlFor="chat-input">
            Question
          </label>
          <textarea
            id="chat-input"
            rows={2}
            maxLength={2000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question about this contract…"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-1 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          {busy ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => stop()} aria-label="Stop generating">
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!input.trim()} aria-label="Send question">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <Disclaimer className="mt-2 px-1" />
      </form>
    </div>
  );
}
