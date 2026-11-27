"use client";

import { Fragment, type ReactNode } from "react";
import type { Citation } from "@/lib/domain";
import { cn } from "@/lib/cn";

/**
 * Renders model output safely (no HTML injection): paragraphs, bullet and
 * numbered lists, **bold**, and [S#] citation markers turned into chips.
 * Markers are only clickable once server-side validation confirmed them.
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
      return <Fragment key={key}>{group[1].split(/\s*[,;]\s*/).map((id) => renderMarker(id, markers, `${key}-${id}`))}</Fragment>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}

/** One citation chip: clickable once validated, struck through if invalid, muted while streaming. */
function renderMarker(id: string, markers: MarkerState, key: string): ReactNode {
  const citation = markers.citations?.get(id);
  if (citation) {
    return (
      <button
        key={key}
        type="button"
        onClick={() => markers.onSelect(citation)}
        className="mx-0.5 inline-flex -translate-y-px items-center rounded bg-accent-soft px-1.5 py-px align-baseline font-mono text-[0.68rem] font-semibold text-accent hover:bg-accent hover:text-white"
        title={`View evidence ${id}`}
      >
        {id}
      </button>
    );
  }
  const invalid = markers.invalid?.has(id);
  return (
    <span
      key={key}
      className={cn(
        "mx-0.5 inline-flex rounded px-1.5 py-px font-mono text-[0.68rem] font-semibold",
        invalid ? "bg-danger-soft text-danger line-through" : "bg-surface-muted text-ink-subtle",
      )}
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

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className={cn("my-2 space-y-1 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((item, i) => (
          <li key={i}>{renderInline(item, markers, `l${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
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
        <p key={`h${idx}`} className="mt-3 mb-1 font-semibold text-ink">
          {renderInline(heading[1], markers, `h${idx}`)}
        </p>
      ) : (
        <p key={`p${idx}`} className="my-2">
          {renderInline(line, markers, `p${idx}`)}
        </p>
      ),
    );
  });
  flushList();
  return <div className="text-sm leading-relaxed text-ink [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>;
}
