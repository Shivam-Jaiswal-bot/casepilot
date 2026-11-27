import { CalendarDays, Check, FileStack, HardDrive, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { DeleteButton, RetryButton } from "@/components/documents/document-actions";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { DocumentStatusBadge } from "@/components/ui/domain-badges";
import { FileIcon } from "@/components/ui/file-icon";
import { Alert, Card, EmptyState, MetaList, Skeleton, Spinner } from "@/components/ui/primitives";
import { Workspace } from "@/components/workspace/workspace";
import { cn } from "@/lib/cn";
import type { DocumentStatus } from "@/lib/domain";
import { formatBytes, formatDate, pluralize } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { getConversation, listConversations, listMessages, toUIMessages } from "@/server/conversations/conversation-service";
import { getDocumentSegments } from "@/server/documents/document-service";
import { loadOwnedDocument } from "@/server/documents/load-owned-document";

export const metadata: Metadata = { title: "Document workspace" };

export default function DocumentWorkspacePage({ params, searchParams }: PageProps<"/documents/[documentId]">) {
  return (
    // Full-height workspace on large screens: viewport minus the main padding (2 × 2rem).
    <div className="mx-auto flex max-w-[1680px] flex-col lg:h-[calc(100dvh-4rem)]">
      <Suspense fallback={<WorkspaceSkeleton />}>
        <WorkspaceContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true" aria-label="Loading document">
      <Skeleton className="h-4 w-56" />
      <div className="flex items-center gap-3.5">
        <Skeleton className="h-12 w-10" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-80" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 min-h-[60vh] flex-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
        <Skeleton className="rounded-xl" />
        <Skeleton className="rounded-xl" />
      </div>
    </div>
  );
}

const STAGES: { status: DocumentStatus; label: string; detail: string }[] = [
  { status: "UPLOADED", label: "Queued", detail: "Waiting for a worker" },
  { status: "PROCESSING", label: "Extracting", detail: "Reading text and detecting sections" },
  { status: "INDEXING", label: "Indexing", detail: "Building the search index" },
  { status: "COMPLETED", label: "Ready", detail: "Ask questions and review risks" },
];

/** Processing progress derived from the document's real status. */
function ProcessingStages({ status }: { status: DocumentStatus }) {
  const current = STAGES.findIndex((s) => s.status === status);
  return (
    <ol className="mx-auto mt-8 grid max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-4">
      {STAGES.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.status} className={cn("rounded-lg border px-3 py-3", active ? "border-accent/30 bg-accent-soft/60" : "border-line bg-surface")}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[0.625rem] font-semibold",
                  done ? "bg-ok text-white" : active ? "bg-accent text-white" : "bg-surface-sunken text-ink-subtle",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : active ? <Spinner className="size-2.5 border-[1.5px]" label={s.label} /> : i + 1}
              </span>
              <span className={cn("text-[0.8125rem] font-medium", active || done ? "text-ink" : "text-ink-subtle")}>{s.label}</span>
            </div>
            <p className="mt-1.5 text-xs leading-snug text-ink-subtle">{s.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

async function WorkspaceContent({ params, searchParams }: Pick<PageProps<"/documents/[documentId]">, "params" | "searchParams">) {
  const user = await requirePageUser();
  const { documentId } = await params;
  const query = await searchParams;
  const doc = await loadOwnedDocument(user.id, documentId);

  const header = (
    <div className="shrink-0">
      <Breadcrumbs items={[{ label: "Documents", href: "/documents" }, { label: doc.title }]} className="mb-3" />
      <header className="flex flex-col gap-4 pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <FileIcon type={doc.fileType} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate font-serif text-[1.375rem] leading-tight font-semibold tracking-[-0.01em] text-ink sm:text-[1.625rem]" title={doc.title}>
              {doc.title}
            </h1>
            <MetaList
              className="mt-1.5"
              items={[
                <DocumentStatusBadge key="s" status={doc.status} />,
                <span key="t" className="font-medium text-ink-muted">{doc.fileType.toUpperCase()}</span>,
                <span key="b" className="inline-flex items-center gap-1.5"><HardDrive aria-hidden />{formatBytes(doc.sizeBytes)}</span>,
                doc.pageCount ? <span key="p" className="inline-flex items-center gap-1.5"><FileStack aria-hidden />{pluralize(doc.pageCount, "page")}</span> : null,
                <span key="d" className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden />Uploaded {formatDate(doc.createdAt)}</span>,
              ]}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {doc.status === "COMPLETED" && (
            <ButtonLink href={`/documents/${doc.id}/risk`}>
              <ShieldCheck aria-hidden /> Risk analysis
            </ButtonLink>
          )}
          <DeleteButton documentId={doc.id} title={doc.title} redirectTo="/documents" size="md" />
        </div>
      </header>
    </div>
  );

  if (doc.status !== "COMPLETED") {
    const failed = doc.status === "FAILED";
    return (
      <>
        {header}
        <AutoRefresh active={!failed} />
        <Card className="mt-2">
          {failed ? (
            <EmptyState
              icon={<TriangleAlert className="text-danger" />}
              title="Processing failed"
              description={doc.errorMessage ?? "The document could not be processed."}
              action={<RetryButton documentId={doc.id} />}
            />
          ) : (
            <div className="px-6 py-14 text-center">
              <h2 className="font-serif text-xl font-semibold text-ink">Preparing your document</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
                {doc.errorMessage ?? "CasePilot is extracting text, detecting sections and building the search index. This page updates automatically."}
              </p>
              <ProcessingStages status={doc.status} />
            </div>
          )}
        </Card>
      </>
    );
  }

  const startNew = query.new === "1";
  const requested = typeof query.c === "string" ? query.c : null;
  const [segments, conversations] = await Promise.all([getDocumentSegments(user.id, doc.id), listConversations(user.id, doc.id)]);

  let conversationId: string | null = null;
  if (requested) {
    const conversation = await getConversation(user.id, requested).catch(() => null);
    if (conversation?.documentId === doc.id) conversationId = conversation.id;
  } else if (!startNew && conversations[0]) {
    conversationId = conversations[0].id;
  }
  const initialMessages = conversationId ? toUIMessages(await listMessages(user.id, conversationId)) : [];
  const warnings = (doc.extractionMeta?.warnings as string[] | undefined) ?? [];

  return (
    <>
      {header}
      {warnings.length > 0 && (
        <Alert kind="warning" className="mb-3 shrink-0" title="Extraction notes">
          {warnings.join(" ")}
        </Alert>
      )}
      <Workspace
        key={conversationId ?? "new"}
        document={{ id: doc.id, title: doc.title, fileType: doc.fileType, pageCount: doc.pageCount }}
        segments={segments}
        initialConversationId={conversationId}
        initialMessages={initialMessages}
        conversations={conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))}
      />
    </>
  );
}
