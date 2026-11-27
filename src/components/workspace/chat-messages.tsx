"use client";

import { ArrowUpRight, Check, Copy, Info, SearchX, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { LogoMark } from "@/components/app/logo";
import { useToast } from "@/components/ui/toast";
import type { AnswerValidation } from "@/lib/chat-types";
import { cn } from "@/lib/cn";
import { formatLocation, type Citation } from "@/lib/domain";
import { AnswerText } from "./answer-text";

export const SUGGESTIONS = [
  "What are the major risks in this contract?",
  "Can the other party terminate without notice?",
  "What is the limitation of liability?",
  "Does this contract renew automatically?",
  "Is there an indemnification clause?",
];

/** Strips [S#] / [S1, S2] markers for clipboard copies. */
const plainText = (text: string) => text.replace(/\s?\[S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*\]/g, "");

export function AssistantAvatar() {
  return <LogoMark className="size-7 shrink-0 rounded-lg shadow-sm" />;
}

export function EmptyConversation({ documentTitle, onAsk }: { documentTitle: string; onAsk: (q: string) => void }) {
  return (
    <div className="mx-auto flex max-w-xl animate-fade-in flex-col items-center px-2 py-8 text-center sm:py-12">
      <LogoMark className="size-11 rounded-xl shadow-md" />
      <h3 className="mt-5 font-serif text-[1.375rem] leading-snug font-semibold text-ink">Ask anything about this contract</h3>
      <p className="mt-2 max-w-md text-[0.8125rem] leading-relaxed text-ink-muted">
        Answers are drawn only from <span className="font-medium text-ink">{documentTitle}</span>, with citations to the exact page and section you can inspect.
      </p>
      <div className="mt-7 grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onAsk(s)}
            className="group flex items-start justify-between gap-3 rounded-lg border text-left border-line bg-surface px-3.5 py-3 text-[0.8125rem] leading-snug text-ink shadow-xs transition-[border-color,box-shadow,background-color] duration-150 hover:border-accent-muted hover:bg-accent-soft/40 hover:shadow-sm"
          >
            {s}
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-ink-subtle transition-[color,transform] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex animate-rise-in justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[0.875rem] leading-relaxed whitespace-pre-wrap text-ink ring-1 ring-accent-muted/50 ring-inset">
        {text}
      </div>
    </div>
  );
}

/** Retrieval, then generation (stages come from the server's status parts). */
function ThinkingSteps({ stage }: { stage: "retrieving" | "generating" | null }) {
  const steps = [
    { key: "retrieving", label: "Searching the document" },
    { key: "generating", label: "Drafting a grounded answer" },
  ] as const;
  const current = stage === "generating" ? 1 : 0;
  return (
    <ol className="space-y-1.5 pt-0.5" aria-live="polite">
      {steps.map((s, i) => (
        <li key={s.key} className={cn("flex items-center gap-2 text-[0.8125rem]", i === current ? "text-ink" : i < current ? "text-ink-subtle" : "text-ink-subtle/60")}>
          {i < current ? (
            <Check className="size-3.5 text-ok" aria-hidden />
          ) : i === current ? (
            <span className="flex w-3.5 justify-center gap-[3px]" aria-hidden>
              {[0, 1, 2].map((d) => (
                <span key={d} className="size-[3px] animate-typing rounded-full bg-accent" style={{ animationDelay: `${d * 150}ms` }} />
              ))}
            </span>
          ) : (
            <span className="size-3.5" aria-hidden />
          )}
          {s.label}
          {i === current && "…"}
        </li>
      ))}
    </ol>
  );
}

/** Pending answer before the assistant message exists. */
export function ThinkingMessage({ stage }: { stage: "retrieving" | "generating" | null }) {
  return (
    <div className="flex animate-fade-in gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-1">
        <ThinkingSteps stage={stage} />
      </div>
    </div>
  );
}

export function AssistantMessage({
  text,
  validation,
  streaming,
  stage = null,
  stopped,
  onSelectCitation,
}: {
  text: string;
  validation: AnswerValidation | undefined;
  streaming: boolean;
  stage?: "retrieving" | "generating" | null;
  stopped: boolean;
  onSelectCitation: (citation: Citation) => void;
}) {
  const citations = validation ? new Map(validation.citations.map((c) => [c.sourceId, c])) : undefined;
  const flagged = validation && (validation.invalidMarkers.length > 0 || validation.unsupportedPageRefs.length > 0);

  return (
    <article className="flex animate-fade-in gap-3" aria-label="Assistant answer">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <span className="font-semibold text-ink">CasePilot</span>
          {validation?.abstained && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-ink-muted ring-1 ring-line ring-inset">
              <SearchX className="size-3" aria-hidden /> Not found in document
            </span>
          )}
          {streaming && text.trim() && <span className="text-ink-subtle">Writing…</span>}
        </div>

        {streaming && !text.trim() ? (
          <ThinkingSteps stage={stage} />
        ) : (
          <AnswerText text={text} markers={{ citations, invalid: new Set(validation?.invalidMarkers), onSelect: onSelectCitation }} />
        )}

        {(validation?.interrupted || stopped) && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-ink-subtle">
            <Info className="size-3.5" aria-hidden /> Response stopped — this answer is incomplete.
          </p>
        )}

        {flagged && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {validation.invalidMarkers.length > 0 && `Unverified citation(s) ${validation.invalidMarkers.join(", ")} did not match retrieved evidence. `}
              {validation.unsupportedPageRefs.length > 0 && `Page reference(s) ${validation.unsupportedPageRefs.join(", ")} are not in the cited sources — verify manually.`}
            </span>
          </div>
        )}

        {validation && validation.citations.length > 0 && <SourceList citations={validation.citations} onSelect={onSelectCitation} />}

        {!streaming && text.trim() && <MessageActions text={text} />}
      </div>
    </article>
  );
}

/** Evidence the answer relies on: each source shows its location and excerpt and opens in the viewer. */
function SourceList({ citations, onSelect }: { citations: Citation[]; onSelect: (c: Citation) => void }) {
  return (
    <section className="mt-4" aria-label="Sources">
      <div className="eyebrow mb-2 flex items-center gap-2">
        Sources <span className="num rounded bg-surface-muted px-1.5 py-px text-[0.625rem] tracking-normal text-ink-muted">{citations.length}</span>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {citations.map((c) => (
          <li key={c.sourceId}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className="group flex w-full items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow,background-color] duration-150 hover:border-accent-muted hover:bg-accent-soft/30 hover:shadow-xs"
            >
              <span className="mt-px inline-flex h-5 shrink-0 items-center rounded bg-accent-soft px-1.5 font-mono text-[0.625rem] font-semibold text-accent ring-1 ring-accent-muted/60 ring-inset group-hover:bg-accent group-hover:text-white">
                {c.sourceId}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink-muted">{formatLocation(c)}</span>
                <span className="mt-0.5 line-clamp-2 font-serif text-[0.8125rem] leading-snug text-ink">{c.excerpt}</span>
              </span>
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-line-strong transition-colors group-hover:text-accent" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MessageActions({ text }: { text: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2.5 flex items-center gap-1">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(plainText(text));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast({ kind: "error", title: "Could not copy", description: "Clipboard access was blocked by the browser." });
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
        aria-label="Copy answer"
      >
        {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
