"use client";

import { Fragment, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatLocation, type Citation } from "@/lib/domain";

/**
 * Renders model output safely (no HTML injection): headings, paragraphs,
 * bullet and numbered lists, block quotes, **bold**, and [S#] citation markers
 * turned into chips. Markers are only clickable once server-side validation
 * confirmed them.
 */
export interface MarkerState {
  /** Validated citations by source id. Undefined while the answer is still streaming. */
  citations?: Map<string, Citation>;
  invalid?: Set<string>;
  onSelect: (citation: Citation) => void;
}

function renderInline(text: string, markers: MarkerState, keyPrefix: string): ReactNode[] {
  return text.split(/(\[S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    const group = part.match(/^\[(S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*)\]$/);
    if (group) {
      // "[S1, S3]" renders as one chip per source.
      return (
        <span key={key} className="whitespace-nowrap">
          {group[1].split(/\s*[,;]\s*/).map((id) => renderMarker(id, markers, `${key}-${id}`))}
        </span>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}

const chipBase = "ml-0.5 inline-flex h-[1.125rem] -translate-y-px items-center rounded px-1 align-middle font-mono text-[0.625rem] leading-none font-semibold";

/** One citation chip: clickable once validated, struck through if invalid, muted while streaming. */
function renderMarker(id: string, markers: MarkerState, key: string): ReactNode {
  const citation = markers.citations?.get(id);
  if (citation) {
    return (
      <Tooltip key={key} content={formatLocation(citation)} className="align-middle">
        <button
          type="button"
          onClick={() => markers.onSelect(citation)}
          className={cn(chipBase, "bg-accent-soft text-accent ring-1 ring-accent-muted/70 ring-inset transition-colors hover:bg-accent hover:text-white hover:ring-accent")}
          aria-label={`View evidence ${id}: ${formatLocation(citation)}`}
        >
          {id}
        </button>
      </Tooltip>
    );
  }
  const invalid = markers.invalid?.has(id);
  return (
    <span
      key={key}
      className={cn(chipBase, invalid ? "bg-danger-soft text-danger line-through" : "bg-surface-muted text-ink-subtle")}
      title={invalid ? "Unverified citation: this source was not among the retrieved evidence" : "Verifying citation…"}
    >
      {id}
    </span>
  );
}

export function AnswerText({ text, markers }: { text: string; markers: MarkerState }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] | null = null;

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const k = blocks.length;
    blocks.push(
      <Tag
        key={`l${k}`}
        className={cn(
          "my-3 space-y-1.5 pl-5",
          list.ordered ? "list-decimal marker:text-[0.8125rem] marker:font-medium marker:text-ink-subtle" : "list-disc marker:text-accent-muted",
        )}
      >
        {list.items.map((item, i) => (
          <li key={i} className="pl-1">
            {renderInline(item, markers, `l${k}-${i}`)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  const flushQuote = () => {
    if (!quote) return;
    const k = blocks.length;
    blocks.push(
      <blockquote key={`q${k}`} className="my-3 border-l-2 border-brass/70 bg-surface-muted/60 py-2 pr-3 pl-4 font-serif text-[0.9rem] leading-relaxed text-ink">
        {renderInline(quote.join(" "), markers, `q${k}`)}
      </blockquote>,
    );
    quote = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) {
      flushList();
      quote ??= [];
      quote.push(quoted[1]);
      return;
    }
    flushQuote();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      return;
    }
    flushList();
    if (!line) return;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      heading ? (
        <h4 key={`h${idx}`} className="mt-5 mb-1.5 text-[0.875rem] font-semibold tracking-[-0.005em] text-ink">
          {renderInline(heading[1], markers, `h${idx}`)}
        </h4>
      ) : (
        <p key={`p${idx}`} className="my-2.5">
          {renderInline(line, markers, `p${idx}`)}
        </p>
      ),
    );
  });
  flushList();
  flushQuote();
  return <div className="text-[0.875rem] leading-[1.7] text-ink/90 text-pretty [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>;
}
