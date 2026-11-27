"use client";

import { BadgeCheck, MapPin } from "lucide-react";
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
  if (!match) return <p className="font-serif text-[0.875rem] leading-relaxed whitespace-pre-line text-ink-muted">{context}</p>;
  const start = Math.max(0, match.index - CONTEXT_CHARS);
  const end = Math.min(context.length, match.index + match[0].length + CONTEXT_CHARS);
  return (
    <p className="font-serif text-[0.875rem] leading-relaxed whitespace-pre-line text-ink-muted">
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <ol className="space-y-3">
        {evidence.map((e, i) => {
          const selected = i === active;
          return (
            <li key={`${e.chunkId}-${i}`}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={selected}
                className={cn(
                  "block w-full rounded-xl border bg-surface p-5 text-left transition-[border-color,box-shadow] duration-150",
                  selected ? "border-accent/40 shadow-md ring-2 ring-accent/10" : "border-line shadow-xs hover:border-line-strong hover:shadow-sm",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-xs">
                    <span className={cn("num flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold", selected ? "bg-accent text-white" : "bg-surface-sunken text-ink-muted")}>
                      {i + 1}
                    </span>
                    <MapPin className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                    <span className="truncate font-medium text-ink-muted">{formatLocation(e)}</span>
                  </span>
                  <Badge
                    tone={e.match === "EXACT" ? "ok" : "warn"}
                    title={e.match === "EXACT" ? "Quote found verbatim in the source" : "Quote closely matches the source (minor differences)"}
                  >
                    {e.match === "EXACT" && <BadgeCheck aria-hidden />}
                    {e.match === "EXACT" ? "Verbatim" : "Near match"}
                  </Badge>
                </div>
                <blockquote className="mt-3.5 border-l-2 border-brass pl-4 font-serif text-[0.975rem] leading-[1.65] text-ink">“{e.quote}”</blockquote>
                {selected && chunkText[e.chunkId] && (
                  <div className="mt-4 animate-fade-in rounded-lg bg-surface-muted/70 px-4 py-3">
                    <div className="eyebrow mb-1.5">Surrounding text</div>
                    <HighlightedContext context={chunkText[e.chunkId]} quote={e.quote} />
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="h-[75vh] min-h-[28rem] overflow-hidden rounded-xl border border-line bg-surface shadow-sm lg:sticky lg:top-6">
        <DocumentViewer key={active} document={document} segments={segments} focus={focus} />
      </div>
    </div>
  );
}
