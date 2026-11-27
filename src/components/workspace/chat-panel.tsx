"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, ChevronDown, History, MessageSquarePlus, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Alert, Disclaimer, Kbd } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import type { AnswerValidation, CasePilotUIMessage, ChatRequestBody } from "@/lib/chat-types";
import { cn } from "@/lib/cn";
import type { Citation } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import { AssistantMessage, EmptyConversation, ThinkingMessage, UserMessage } from "./chat-messages";

const MAX_CHARS = 2000;

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
  updatedAt?: Date | string;
}

export function ChatPanel({
  documentId,
  documentTitle,
  initialConversationId,
  initialMessages,
  conversations,
  onSelectCitation,
}: {
  documentId: string;
  documentTitle: string;
  initialConversationId: string | null;
  initialMessages: CasePilotUIMessage[];
  conversations: ConversationSummary[];
  onSelectCitation: (citation: Citation) => void;
}) {
  const router = useRouter();
  const conversationRef = useRef<string | null>(initialConversationId);
  const [stage, setStage] = useState<"retrieving" | "generating" | null>(null);
  /** Assistant message the user stopped in this session (stored partial answers carry validation.interrupted). */
  const [stoppedId, setStoppedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const scrollToEnd = (behavior: ScrollBehavior = "smooth") =>
    queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior }));

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
      scrollToEnd();
    },
    onFinish: () => setStage(null),
    onError: () => setStage(null),
  });

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const awaitingFirstToken = busy && last?.role !== "assistant";

  // Open existing conversations at the latest answer (new ones start at the top).
  const hasInitialMessages = initialMessages.length > 0;
  useEffect(() => {
    if (hasInitialMessages) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [hasInitialMessages]);

  // Grow the textarea with its content (DOM-only side effect).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    setInput("");
    // The conversation id is read here (an event handler), not during render.
    void sendMessage({ text: trimmed }, { body: { conversationId: conversationRef.current ?? undefined } });
    scrollToEnd();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(input);
    }
  };
  const onStop = () => {
    if (last?.role === "assistant") setStoppedId(last.id);
    void stop();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.875rem] font-semibold text-ink">Contract Assistant</h2>
        </div>
        {conversations.length > 0 && (
          <Dropdown
            label="Conversation history"
            header="Conversations"
            triggerClassName={cn(buttonClasses("ghost", "xs"), "gap-1.5")}
            trigger={
              <>
                <History aria-hidden />
                <span className="hidden sm:inline">History</span>
                <span className="num rounded bg-surface-sunken px-1 text-[0.625rem] text-ink-muted">{conversations.length}</span>
                <ChevronDown className="size-3 text-ink-subtle" aria-hidden />
              </>
            }
            items={conversations.map((c) => ({
              key: c.id,
              label: c.title,
              description: c.updatedAt ? `Updated ${formatDateTime(c.updatedAt)}` : undefined,
              selected: c.id === initialConversationId,
              onSelect: () => router.push(`/documents/${documentId}?c=${c.id}`),
            }))}
          />
        )}
        <Tooltip content="Start a new conversation" side="bottom">
          <a href={`/documents/${documentId}?new=1`} className={buttonClasses("secondary", "xs")} aria-label="New conversation">
            <MessageSquarePlus aria-hidden />
            <span className="hidden sm:inline">New</span>
          </a>
        </Tooltip>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-smooth" aria-live="polite">
        <div className="mx-auto max-w-3xl space-y-7 px-4 py-6 sm:px-6">
          {messages.length === 0 && <EmptyConversation documentTitle={documentTitle} onAsk={submit} />}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <UserMessage key={m.id} text={textOf(m)} />
            ) : (
              <AssistantMessage
                key={m.id}
                text={textOf(m)}
                validation={validationOf(m)}
                streaming={busy && i === messages.length - 1}
                stage={stage}
                stopped={m.id === stoppedId}
                onSelectCitation={onSelectCitation}
              />
            ),
          )}

          {awaitingFirstToken && <ThinkingMessage stage={stage} />}
          {error && <Alert kind="error" title="The assistant could not answer">{friendlyError(error)}</Alert>}
        </div>
      </div>

      {/* Composer */}
      <form onSubmit={onSubmit} className="shrink-0 border-t border-line bg-surface px-3 pt-3 pb-2.5 sm:px-4">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-line-strong bg-surface shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:border-focus focus-within:ring-[3px] focus-within:ring-focus/12">
            <label className="sr-only" htmlFor="chat-input">
              Ask a question about this contract
            </label>
            <textarea
              ref={inputRef}
              id="chat-input"
              rows={1}
              maxLength={MAX_CHARS}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about terms, obligations, deadlines or risks…"
              className="scroll-thin block max-h-42 min-h-[3rem] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[0.875rem] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
              <p className="hidden items-center gap-1 text-[0.6875rem] text-ink-subtle sm:flex">
                <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
              </p>
              <div className="ml-auto flex items-center gap-2">
                {input.length > MAX_CHARS * 0.8 && (
                  <span className={cn("num text-[0.6875rem]", input.length >= MAX_CHARS ? "text-danger" : "text-ink-subtle")}>
                    {input.length}/{MAX_CHARS}
                  </span>
                )}
                {busy ? (
                  <Button variant="secondary" size="xs" onClick={onStop} aria-label="Stop generating">
                    <Square className="fill-current" aria-hidden />
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="Send question" className="rounded-lg">
                    <ArrowUp aria-hidden />
                  </Button>
                )}
              </div>
            </div>
          </div>
          <Disclaimer className="mt-2 px-1 text-center text-[0.6875rem]" />
        </div>
      </form>
    </div>
  );
}
