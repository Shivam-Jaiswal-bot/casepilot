"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import type { FocusedEvidence, ViewerSegment } from "./types";

const preview = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 110);

/**
 * Navigation rail beside the document. For PDFs: one entry per page with a
 * preview of that page's indexed text (a lightweight stand-in for image
 * thumbnails that needs no PDF rendering library). For DOCX: the detected
 * sections. Pages that contain the focused evidence carry a marker.
 */
export function PageRail({
  isPdf,
  pageCount,
  page,
  segments,
  focus,
  onSelectPage,
  onSelectSection,
}: {
  isPdf: boolean;
  pageCount: number;
  page: number;
  segments: ViewerSegment[];
  focus: FocusedEvidence | null;
  onSelectPage: (page: number) => void;
  onSelectSection: (segmentIndex: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  const pages = useMemo(() => {
    if (!isPdf) return [];
    const byPage = new Map<number, string>();
    for (const s of segments) if (s.pageNumber && !byPage.has(s.pageNumber)) byPage.set(s.pageNumber, preview(s.text));
    return Array.from({ length: pageCount }, (_, i) => ({ n: i + 1, text: byPage.get(i + 1) ?? "" }));
  }, [isPdf, pageCount, segments]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [page]);

  const hasEvidence = (n: number) => focus?.pageStart != null && n >= focus.pageStart && n <= (focus.pageEnd ?? focus.pageStart);

  return (
    <nav aria-label={isPdf ? "Pages" : "Sections"} className="scroll-thin h-full w-44 shrink-0 overflow-y-auto border-r border-line bg-surface-muted/60 p-2">
      <div className="eyebrow px-1.5 pt-1 pb-2">{isPdf ? `${pageCount} pages` : `${segments.length} sections`}</div>
      <ol className="space-y-1.5">
        {isPdf
          ? pages.map(({ n, text }) => {
              const active = n === page;
              return (
                <li key={n}>
                  <button
                    ref={active ? activeRef : undefined}
                    type="button"
                    onClick={() => onSelectPage(n)}
                    aria-current={active ? "page" : undefined}
                    aria-label={`Page ${n}${hasEvidence(n) ? ", contains cited evidence" : ""}`}
                    className={cn(
                      "group relative w-full rounded-md border bg-surface p-2 text-left transition-[border-color,box-shadow] duration-150",
                      active ? "border-accent shadow-sm ring-2 ring-accent/15" : "border-line hover:border-line-strong hover:shadow-xs",
                    )}
                  >
                    <span className="block h-14 overflow-hidden font-serif text-[0.5625rem] leading-[0.8rem] text-ink-subtle">{text || "No extractable text"}</span>
                    <span className="mt-1.5 flex items-center justify-between">
                      <span className={cn("num text-[0.6875rem] font-semibold", active ? "text-accent" : "text-ink-muted")}>{n}</span>
                      {hasEvidence(n) && <span className="size-1.5 rounded-full bg-brass" aria-hidden />}
                    </span>
                  </button>
                </li>
              );
            })
          : segments.map((s) => (
              <li key={s.segmentIndex}>
                <button
                  type="button"
                  onClick={() => onSelectSection(s.segmentIndex)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs leading-snug text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  <span className="line-clamp-2">{s.sectionTitle ?? `Section ${s.segmentIndex + 1}`}</span>
                </button>
              </li>
            ))}
      </ol>
    </nav>
  );
}
