import { ArrowLeft, Loader, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { DeleteButton, RetryButton } from "@/components/documents/document-actions";
import { ButtonLink } from "@/components/ui/button";
import { DocumentStatusBadge } from "@/components/ui/domain-badges";
import { Alert, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { Workspace } from "@/components/workspace/workspace";
import { formatBytes, formatDate } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { getConversation, listConversations, listMessages, toUIMessages } from "@/server/conversations/conversation-service";
import { getDocumentSegments } from "@/server/documents/document-service";
import { loadOwnedDocument } from "@/server/documents/load-owned-document";

export const metadata: Metadata = { title: "Document workspace" };

export default function DocumentWorkspacePage({ params, searchParams }: PageProps<"/documents/[documentId]">) {
  return (
    <div className="mx-auto max-w-[1600px]">
      <Link href="/documents" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Documents
      </Link>
      <Suspense fallback={<WorkspaceSkeleton />}>
        <WorkspaceContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-14 w-1/2" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[70vh]" />
        <Skeleton className="h-[70vh]" />
      </div>
    </div>
  );
}

async function WorkspaceContent({ params, searchParams }: Pick<PageProps<"/documents/[documentId]">, "params" | "searchParams">) {
  const user = await requirePageUser();
  const { documentId } = await params;
  const query = await searchParams;
  const doc = await loadOwnedDocument(user.id, documentId);

  const meta = [doc.fileType.toUpperCase(), formatBytes(doc.sizeBytes), doc.pageCount ? `${doc.pageCount} pages` : null, `Uploaded ${formatDate(doc.createdAt)}`]
    .filter(Boolean)
    .join(" · ");

  const header = (
    <PageHeader
      title={doc.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <DocumentStatusBadge status={doc.status} /> {meta}
        </span>
      }
      actions={
        <>
          {doc.status === "COMPLETED" && (
            <ButtonLink href={`/documents/${doc.id}/risk`} variant="primary">
              <ShieldCheck className="size-4" aria-hidden /> Risk analysis
            </ButtonLink>
          )}
          <DeleteButton documentId={doc.id} title={doc.title} redirectTo="/documents" />
        </>
      }
    />
  );

  if (doc.status !== "COMPLETED") {
    const failed = doc.status === "FAILED";
    return (
      <>
        {header}
        <AutoRefresh active={!failed} />
        <Card>
          <EmptyState
            icon={failed ? undefined : <Loader className="size-5 animate-spin" />}
            title={failed ? "Processing failed" : "Preparing your document"}
            description={
              failed
                ? (doc.errorMessage ?? "The document could not be processed.")
                : (doc.errorMessage ?? "CasePilot is extracting text, detecting sections and building the search index. This page updates automatically.")
            }
            action={failed ? <RetryButton documentId={doc.id} /> : undefined}
          />
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
        <Alert kind="warning" className="mb-4" title="Extraction notes">
          {warnings.join(" ")}
        </Alert>
      )}
      <Workspace
        key={conversationId ?? "new"}
        document={{ id: doc.id, title: doc.title, fileType: doc.fileType, pageCount: doc.pageCount }}
        segments={segments}
        initialConversationId={conversationId}
        initialMessages={initialMessages}
        conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
      />
    </>
  );
}
