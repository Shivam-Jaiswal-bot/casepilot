"use client";

import { Quote } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/primitives";
import { DocumentViewer } from "@/components/workspace/document-viewer";
import type { ViewerSegment, WorkspaceDocument } from "@/components/workspace/types";
import { cn } from "@/lib/cn";
import { formatLocation, type FindingEvidence } from "@/lib/domain";

const CONTEXT_CHARS = 450;

/**
 * Renders a window of `context` around the first occurrence of `quote`
 * (whitespace-insensitive), with the quote highlighted.
 */
function HighlightedContext({ context, quote }: { context: string; quote: string }) {
  const escaped = quote
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = escaped ? new RegExp(escaped, "i").exec(context) : null;
  if (!match) return <p className="whitespace-pre-line font-serif text-[0.9rem] leading-relaxed text-ink-muted">{context}</p>;
  const start = Math.max(0, match.index - CONTEXT_CHARS);
  const end = Math.min(context.length, match.index + match[0].length + CONTEXT_CHARS);
  return (
    <p className="whitespace-pre-line font-serif text-[0.9rem] leading-relaxed text-ink-muted">
      {start > 0 && "…"}
      {context.slice(start, match.index)}
      <mark className="evidence-highlight bg-transparent text-ink">{match[0]}</mark>
      {context.slice(match.index + match[0].length, end)}
      {end < context.length && "…"}
    </p>
  );
}

export function EvidenceInspector({
  document,
  segments,
  evidence,
  chunkText,
}: {
  document: WorkspaceDocument;
  segments: ViewerSegment[];
  evidence: FindingEvidence[];
  chunkText: Record<string, string>;
}) {
  const [active, setActive] = useState(0);
  const current = evidence[active];
  // Focus on the verified quote itself (not the whole chunk) so the viewer highlights exactly the cited passage.
  const focus = useMemo(
    () =>
      current
        ? { label: `#${active + 1}`, excerpt: current.quote, pageStart: current.pageStart, pageEnd: current.pageEnd, sectionTitle: current.sectionTitle }
        : null,
    [active, current],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        {evidence.map((e, i) => (
          <button
            key={`${e.chunkId}-${i}`}
            onClick={() => setActive(i)}
            aria-pressed={i === active}
            className={cn(
              "block w-full rounded-lg border bg-surface p-4 text-left shadow-(--shadow-card) transition-colors",
              i === active ? "border-accent ring-1 ring-accent/30" : "border-line hover:border-line-strong",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                Evidence #{i + 1} · <span className="font-normal text-ink-muted">{formatLocation(e)}</span>
              </span>
              <Badge tone={e.match === "EXACT" ? "ok" : "warn"} title={e.match === "EXACT" ? "Quote found verbatim in the source" : "Quote closely matches the source (minor differences)"}>
                {e.match === "EXACT" ? "Verbatim" : "Near match"}
              </Badge>
            </div>
            <blockquote className="mt-2 flex gap-2 font-serif text-[0.95rem] leading-relaxed text-ink">
              <Quote className="mt-1 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
              <span>{e.quote}</span>
            </blockquote>
            {i === active && chunkText[e.chunkId] && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1 text-[0.7rem] font-medium uppercase tracking-wider text-ink-subtle">Surrounding text</div>
                <HighlightedContext context={chunkText[e.chunkId]} quote={e.quote} />
              </div>
            )}
          </button>
        ))}
      </div>
      <div className="h-[75vh] overflow-hidden rounded-lg border border-line bg-surface shadow-(--shadow-card) lg:sticky lg:top-6">
        <DocumentViewer key={active} document={document} segments={segments} focus={focus} onClearFocus={() => undefined} />
      </div>
    </div>
  );
}
