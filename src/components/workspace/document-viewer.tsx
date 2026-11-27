"use client";

import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, PanelLeft, PanelLeftClose, ScrollText, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Spinner } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatLocation } from "@/lib/domain";
import { PageRail } from "./page-rail";
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

/** Zoom steps for the PDF view; "fit" fits the page width to the pane. */
const ZOOM_STEPS = ["fit", 50, 75, 100, 125, 150, 200] as const;
type Zoom = (typeof ZOOM_STEPS)[number];

const toolButton =
  "inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4";

/**
 * Dual-mode document viewer with a native CasePilot toolbar:
 *  - "Original": the uploaded PDF, rendered by the browser's PDF engine with
 *    its own toolbar hidden; page and zoom are driven from our toolbar via
 *    PDF open parameters (#page, #zoom). DOCX originals are downloadable only.
 *  - "Indexed text": the text CasePilot actually indexed, laid out as pages,
 *    with the cited evidence highlighted — what every answer is grounded in.
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
  /** Omit when the focused evidence cannot be dismissed (e.g. the finding inspector). */
  onClearFocus?: () => void;
}) {
  const isPdf = doc.fileType === "pdf";
  const [mode, setMode] = useState<"original" | "text">(isPdf ? "original" : "text");
  const [page, setPage] = useState(focus?.pageStart ?? 1);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [railOpen, setRailOpen] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
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

  const goTo = (n: number) => setPage(Math.min(pageCount, Math.max(1, n)));
  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const pdfSrc = `${fileUrl}#page=${page}&${zoom === "fit" ? "view=FitH" : `zoom=${zoom}`}&toolbar=0&navpanes=0`;
  const pdfLoading = mode === "original" && isPdf && loadedSrc !== pdfSrc;

  const scrollToSection = (segmentIndex: number) => {
    setMode("text");
    requestAnimationFrame(() => textRef.current?.querySelector(`[data-segment='${segmentIndex}']`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        <Tooltip content={railOpen ? "Hide pages" : isPdf ? "Show pages" : "Show sections"} side="bottom">
          <button
            type="button"
            onClick={() => setRailOpen((o) => !o)}
            aria-pressed={railOpen}
            aria-label={railOpen ? "Hide page navigation" : "Show page navigation"}
            className={cn(toolButton, railOpen && "bg-surface-muted text-ink")}
          >
            {railOpen ? <PanelLeftClose /> : <PanelLeft />}
          </button>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />

        <div className="flex rounded-lg bg-surface-sunken/80 p-0.5" role="tablist" aria-label="Viewer mode">
          {isPdf && (
            <ModeTab active={mode === "original"} onClick={() => setMode("original")} icon={<FileText />}>
              Original
            </ModeTab>
          )}
          <ModeTab active={mode === "text"} onClick={() => setMode("text")} icon={<ScrollText />}>
            Indexed text
          </ModeTab>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          {isPdf && (
            <div className="flex items-center gap-0.5" role="group" aria-label="Page navigation">
              <button type="button" className={toolButton} aria-label="Previous page" disabled={page <= 1} onClick={() => goTo(page - 1)}>
                <ChevronLeft />
              </button>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="sr-only">Page</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={pageCount}
                  value={page}
                  onChange={(e) => goTo(Number(e.target.value) || 1)}
                  className="num h-7 w-10 rounded-md border border-line bg-surface text-center text-xs text-ink [appearance:textfield] focus:border-focus focus:ring-[3px] focus:ring-focus/15 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="num hidden whitespace-nowrap sm:inline">of {pageCount}</span>
              </label>
              <button type="button" className={toolButton} aria-label="Next page" disabled={page >= pageCount} onClick={() => goTo(page + 1)}>
                <ChevronRight />
              </button>
            </div>
          )}

          {isPdf && mode === "original" && (
            <>
              <span className="mx-1 hidden h-5 w-px bg-line md:block" aria-hidden />
              <div className="hidden items-center gap-0.5 md:flex" role="group" aria-label="Zoom">
                <button type="button" className={toolButton} aria-label="Zoom out" disabled={zoomIndex <= 0} onClick={() => setZoom(ZOOM_STEPS[zoomIndex - 1])}>
                  <ZoomOut />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom("fit")}
                  aria-label="Fit page width"
                  className="num h-7 min-w-12 rounded-md px-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  {zoom === "fit" ? "Fit" : `${zoom}%`}
                </button>
                <button type="button" className={toolButton} aria-label="Zoom in" disabled={zoomIndex >= ZOOM_STEPS.length - 1} onClick={() => setZoom(ZOOM_STEPS[zoomIndex + 1])}>
                  <ZoomIn />
                </button>
              </div>
            </>
          )}

          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {isPdf && (
            <Tooltip content="Open in new tab" side="bottom">
              <a href={`${fileUrl}#page=${page}`} target="_blank" rel="noopener" className={toolButton} aria-label="Open original in a new tab">
                <ExternalLink />
              </a>
            </Tooltip>
          )}
          <Tooltip content="Download original" side="bottom">
            <a href={fileUrl} download className={toolButton} aria-label="Download original file">
              <Download />
            </a>
          </Tooltip>
        </div>
      </div>

      {/* Focused evidence */}
      {focus && (
        <div className="shrink-0 animate-fade-in border-b border-[#efdca5] bg-[#fdf8ea] px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded bg-accent px-1.5 font-mono text-[0.625rem] font-semibold text-white">{focus.label}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-ink-muted">Cited evidence · {formatLocation(focus)}</div>
              <p className="mt-1 line-clamp-3 font-serif text-[0.875rem] leading-relaxed text-ink">{focus.excerpt}</p>
              {mode === "original" && (
                <button type="button" onClick={() => setMode("text")} className="mt-1.5 text-xs font-medium text-accent underline-offset-4 hover:underline">
                  Highlight in indexed text
                </button>
              )}
            </div>
            {onClearFocus && (
              <button type="button" onClick={onClearFocus} className="-m-1 rounded-md p-1 text-ink-subtle transition-colors hover:bg-white hover:text-ink" aria-label="Close evidence">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <PageRail
            isPdf={isPdf}
            pageCount={pageCount}
            page={page}
            segments={segments}
            focus={focus}
            onSelectPage={goTo}
            onSelectSection={scrollToSection}
          />
        )}

        <div className="relative min-w-0 flex-1 overflow-hidden bg-surface-sunken/70">
          {mode === "original" && isPdf ? (
            <>
              {/* Remount on page/zoom change: browser PDF viewers only honour open parameters on load. */}
              <iframe
                key={pdfSrc}
                src={pdfSrc}
                title={`${doc.title}, page ${page}`}
                onLoad={() => setLoadedSrc(pdfSrc)}
                className="size-full border-0"
              />
              {pdfLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-sunken/70" aria-live="polite">
                  <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted shadow-sm">
                    <Spinner className="text-accent" label="Loading document" /> Loading page {page}…
                  </span>
                </div>
              )}
            </>
          ) : (
            <div ref={textRef} className="@container scroll-thin h-full overflow-y-auto px-3 py-5 sm:px-5 sm:py-6">
              {visibleSegments.length === 0 && (
                <EmptyState compact icon={<ScrollText />} title="No extractable text on this page" description="The page may contain only images or scanned content." />
              )}
              {visibleSegments.map((s) => (
                <article
                  key={s.segmentIndex}
                  data-segment={s.segmentIndex}
                  className="mx-auto mb-5 max-w-[44rem] scroll-mt-4 rounded-sm border border-line bg-surface px-5 py-6 shadow-sm @lg:px-8 @lg:py-8 @2xl:px-12 @2xl:py-10"
                >
                  <div className="mb-5 flex items-center justify-between border-b border-line pb-3">
                    <span className="eyebrow">{s.sectionTitle ?? (isPdf ? "Indexed text" : `Section ${s.segmentIndex + 1}`)}</span>
                    {s.pageNumber && <span className="num text-[0.6875rem] text-ink-subtle">Page {s.pageNumber} of {pageCount}</span>}
                  </div>
                  {s.text.split("\n\n").map((para, i) => {
                    const hit = focus ? paragraphMatches(para, focus.excerpt) : false;
                    return (
                      <p key={i} data-evidence={hit || undefined} className={cn("mb-3.5 font-serif text-[0.95rem] leading-[1.75] text-ink last:mb-0", hit && "evidence-highlight")}>
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
    </div>
  );
}

function ModeTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-3.5",
        active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
      <span className="sr-only sm:hidden">{children}</span>
    </button>
  );
}
