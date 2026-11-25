"use client";

import { useState } from "react";
import type { CasePilotUIMessage } from "@/lib/chat-types";
import type { Citation } from "@/lib/domain";
import { ChatPanel, type ConversationSummary } from "./chat-panel";
import { DocumentViewer } from "./document-viewer";
import type { FocusedEvidence, ViewerSegment, WorkspaceDocument } from "./types";

/** Two-pane workspace: the document on the left, the grounded assistant on the right. */
export function Workspace(props: {
  document: WorkspaceDocument;
  segments: ViewerSegment[];
  initialConversationId: string | null;
  initialMessages: CasePilotUIMessage[];
  conversations: ConversationSummary[];
  initialFocus?: FocusedEvidence | null;
}) {
  const [focus, setFocus] = useState<FocusedEvidence | null>(props.initialFocus ?? null);

  const selectCitation = (c: Citation) =>
    setFocus({ label: c.sourceId, excerpt: c.excerpt, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionTitle: c.sectionTitle });

  return (
    <div className="grid min-h-0 gap-4 lg:h-[calc(100vh-11.5rem)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section aria-label="Document viewer" className="h-[70vh] min-h-0 overflow-hidden rounded-lg border border-line bg-surface shadow-(--shadow-card) lg:h-auto">
        <DocumentViewer document={props.document} segments={props.segments} focus={focus} onClearFocus={() => setFocus(null)} />
      </section>
      <section aria-label="AI assistant" className="h-[75vh] min-h-0 overflow-hidden rounded-lg border border-line bg-surface shadow-(--shadow-card) lg:h-auto">
        <ChatPanel
          documentId={props.document.id}
          initialConversationId={props.initialConversationId}
          initialMessages={props.initialMessages}
          conversations={props.conversations}
          onSelectCitation={selectCitation}
        />
      </section>
    </div>
  );
}
