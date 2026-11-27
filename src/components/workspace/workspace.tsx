"use client";

import { FileText, MessagesSquare } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CasePilotUIMessage } from "@/lib/chat-types";
import { cn } from "@/lib/cn";
import type { Citation } from "@/lib/domain";
import { ChatPanel, type ConversationSummary } from "./chat-panel";
import { DocumentViewer } from "./document-viewer";
import type { FocusedEvidence, ViewerSegment, WorkspaceDocument } from "./types";

const MIN_SPLIT = 0.34;
const MAX_SPLIT = 0.7;
const clamp = (n: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, n));

/**
 * Two-pane workspace: the document on the left, the grounded assistant on the
 * right. On large screens the divider can be dragged (or moved with the arrow
 * keys). Below the `lg` breakpoint the panes become tabs; both stay mounted so
 * the conversation is never lost when switching.
 */
export function Workspace(props: {
  document: WorkspaceDocument;
  segments: ViewerSegment[];
  initialConversationId: string | null;
  initialMessages: CasePilotUIMessage[];
  conversations: ConversationSummary[];
  initialFocus?: FocusedEvidence | null;
}) {
  const [focus, setFocus] = useState<FocusedEvidence | null>(props.initialFocus ?? null);
  const [split, setSplit] = useState(0.54);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<"document" | "assistant">("assistant");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectCitation = (c: Citation) => {
    setFocus({ label: c.sourceId, excerpt: c.excerpt, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionTitle: c.sectionTitle });
    // On stacked layouts, show the evidence immediately.
    if (!window.matchMedia("(min-width: 64rem)").matches) setTab("document");
  };

  const onPointerMove = (e: PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!dragging || !rect) return;
    setSplit(clamp((e.clientX - rect.left) / rect.width));
  };

  const onSeparatorKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.08 : 0.02;
    const next: Record<string, (s: number) => number> = {
      ArrowLeft: (s) => s - step,
      ArrowRight: (s) => s + step,
      Home: () => MIN_SPLIT,
      End: () => MAX_SPLIT,
    };
    const update = next[e.key];
    if (!update) return;
    e.preventDefault();
    setSplit((s) => clamp(update(s)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Stacked layouts: pane switcher */}
      <div className="flex rounded-lg border border-line bg-surface p-1 shadow-xs lg:hidden" role="tablist" aria-label="Workspace panes">
        <PaneTab active={tab === "document"} onClick={() => setTab("document")} icon={<FileText />}>
          Document
          {focus && <span className="ml-1 size-1.5 rounded-full bg-brass" aria-label="(evidence selected)" />}
        </PaneTab>
        <PaneTab active={tab === "assistant"} onClick={() => setTab("assistant")} icon={<MessagesSquare />}>
          Assistant
        </PaneTab>
      </div>

      <div
        ref={containerRef}
        style={{ "--split": `${split * 100}%` } as React.CSSProperties}
        className={cn("relative flex min-h-0 flex-1 gap-0", dragging && "cursor-col-resize select-none")}
      >
        <section
          aria-label="Document viewer"
          className={cn(
            "h-[calc(100dvh-14rem)] min-h-[30rem] min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface shadow-sm lg:block lg:h-auto lg:min-h-0 lg:flex-none lg:basis-[var(--split)]",
            tab === "document" ? "block" : "hidden",
          )}
        >
          <DocumentViewer document={props.document} segments={props.segments} focus={focus} onClearFocus={() => setFocus(null)} />
        </section>

        {/* Resize handle (large screens) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize document and assistant panes"
          aria-valuemin={Math.round(MIN_SPLIT * 100)}
          aria-valuemax={Math.round(MAX_SPLIT * 100)}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          onKeyDown={onSeparatorKey}
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={() => setSplit(0.54)}
          className="group hidden w-3 shrink-0 cursor-col-resize items-center justify-center rounded-full outline-none lg:flex"
        >
          <span
            className={cn(
              "h-12 w-1 rounded-full transition-colors duration-150",
              dragging ? "bg-accent" : "bg-line-strong/70 group-hover:bg-ink-subtle group-focus-visible:bg-focus",
            )}
          />
        </div>

        <section
          aria-label="AI contract assistant"
          className={cn(
            "h-[calc(100dvh-14rem)] min-h-[30rem] min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface shadow-sm lg:block lg:h-auto lg:min-h-0",
            tab === "assistant" ? "block" : "hidden",
          )}
        >
          <ChatPanel
            documentId={props.document.id}
            documentTitle={props.document.title}
            initialConversationId={props.initialConversationId}
            initialMessages={props.initialMessages}
            conversations={props.conversations}
            onSelectCitation={selectCitation}
          />
        </section>

        {/* While dragging, a shield keeps the PDF iframe from swallowing pointer events. */}
        {dragging && (
          <div
            className="fixed inset-0 z-50 cursor-col-resize"
            onPointerMove={onPointerMove}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
            onPointerLeave={() => setDragging(false)}
          />
        )}
      </div>
    </div>
  );
}

function PaneTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-4",
        active ? "bg-accent text-white shadow-sm" : "text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
