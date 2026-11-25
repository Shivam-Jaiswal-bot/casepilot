"use client";

import { ChevronLeft, ChevronRight, ExternalLink, FileText, ScrollText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatLocation } from "@/lib/domain";
import type { FocusedEvidence, ViewerSegment, WorkspaceDocument } from "./types";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Paragraph-level evidence matching (chunk text and segment text can differ in heading/line layout). */
function paragraphMatches(paragraph: string, excerpt: string): boolean {
  const p = norm(paragraph);
  const e = norm(excerpt.replace(/…$/, ""));
  if (p.length < 12 || !e) return false;
  const probe = p.slice(0, 60);
  return e.includes(probe) || p.includes(e.slice(0, 60));
}

/**
 * Dual-mode viewer:
 *  - "Original": the uploaded PDF rendered by the browser's PDF viewer, opened
 *    at the cited page (#page=N). DOCX originals are downloadable only.
 *  - "Text": the extracted text CasePilot actually indexed, with the cited
 *    evidence highlighted – this is exactly what answers are grounded in.
 */
export function DocumentViewer({
  document: doc,
  segments,
  focus,
  onClearFocus,
}: {
  document: WorkspaceDocument;
  segments: ViewerSegment[];
  focus: FocusedEvidence | null;
  onClearFocus: () => void;
}) {
  const isPdf = doc.fileType === "pdf";
  const [mode, setMode] = useState<"original" | "text">(isPdf ? "original" : "text");
  const [page, setPage] = useState(focus?.pageStart ?? 1);
  const pageCount = doc.pageCount ?? 1;
  const textRef = useRef<HTMLDivElement>(null);
  const fileUrl = `/api/documents/${doc.id}/file`;

  // Jump to the cited page whenever a new citation is focused ("adjust state on prop change" pattern).
  const [prevFocus, setPrevFocus] = useState(focus);
  if (focus !== prevFocus) {
    setPrevFocus(focus);
    if (focus?.pageStart) setPage(focus.pageStart);
  }

  // Scroll the highlighted evidence into view (DOM side effect only).
  useEffect(() => {
    if (!focus) return;
    const timer = setTimeout(() => {
      textRef.current?.querySelector<HTMLElement>("[data-evidence='true']")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(timer);
  }, [focus, mode, page]);

  const visibleSegments = useMemo(() => {
    if (!isPdf) return segments;
    return segments.filter((s) => s.pageNumber === page);
  }, [isPdf, page, segments]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="flex rounded-md border border-line bg-surface-muted p-0.5" role="tablist" aria-label="Viewer mode">
          {isPdf && (
            <button
              role="tab"
              aria-selected={mode === "original"}
              onClick={() => setMode("original")}
              className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium", mode === "original" ? "bg-surface text-ink shadow-(--shadow-card)" : "text-ink-muted")}
            >
              <FileText className="size-3.5" aria-hidden /> Original
            </button>
          )}
          <button
            role="tab"
            aria-selected={mode === "text"}
            onClick={() => setMode("text")}
            className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium", mode === "text" ? "bg-surface text-ink shadow-(--shadow-card)" : "text-ink-muted")}
          >
            <ScrollText className="size-3.5" aria-hidden /> Indexed text
          </button>
        </div>

        {isPdf && (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              <span className="sr-only">Page</span>
              <input
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(e) => setPage(Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)))}
                className="h-7 w-12 rounded border border-line-strong bg-surface text-center text-xs tabular-nums"
              />
              / {pageCount}
            </label>
            <Button variant="ghost" size="sm" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        {!isPdf && (
          <a href={fileUrl} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            Download original <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>

      {focus && (
        <div className="border-b border-line bg-warn-soft/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-ink">
                Evidence {focus.label} · <span className="font-normal text-ink-muted">{formatLocation(focus)}</span>
              </div>
              <p className="mt-1 line-clamp-4 font-serif text-[0.85rem] leading-relaxed text-ink">{focus.excerpt}</p>
            </div>
            <button onClick={onClearFocus} className="rounded p-1 text-ink-subtle hover:bg-surface hover:text-ink" aria-label="Close evidence">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden bg-surface-muted/40">
        {mode === "original" && isPdf ? (
          // Remount on page change: browser PDF viewers only honour #page on load.
          <iframe key={page} src={`${fileUrl}#page=${page}&view=FitH`} title={`${doc.title} – page ${page}`} className="size-full border-0 bg-surface" />
        ) : (
          <div ref={textRef} className="h-full overflow-y-auto px-6 py-5">
            {visibleSegments.length === 0 && <p className="text-sm text-ink-muted">No extractable text on this page.</p>}
            {visibleSegments.map((s) => (
              <article key={s.segmentIndex} className="mx-auto mb-6 max-w-2xl rounded-md border border-line bg-surface px-6 py-5 shadow-(--shadow-card)">
                <div className="mb-3 text-[0.7rem] font-medium uppercase tracking-wider text-ink-subtle">
                  {s.pageNumber ? `Page ${s.pageNumber}` : (s.sectionTitle ?? `Section ${s.segmentIndex + 1}`)}
                </div>
                {s.text.split("\n\n").map((para, i) => {
                  const hit = focus ? paragraphMatches(para, focus.excerpt) : false;
                  return (
                    <p key={i} data-evidence={hit || undefined} className={cn("mb-3 font-serif text-[0.92rem] leading-relaxed text-ink", hit && "evidence-highlight")}>
                      {para}
                    </p>
                  );
                })}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
