import { FileSearch, FileStack, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { DeleteButton, RetryButton } from "@/components/documents/document-actions";
import { LibraryFilters } from "@/components/documents/library-filters";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
import { ButtonLink } from "@/components/ui/button";
import { DocumentStatusBadge } from "@/components/ui/domain-badges";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { ACTIVE_DOCUMENT_STATUSES, DOCUMENT_STATUSES } from "@/lib/domain";
import { formatBytes, formatDate } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";
import { listDocuments } from "@/server/documents/document-service";

export const metadata: Metadata = { title: "Documents" };

const filterSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  status: z.enum([...DOCUMENT_STATUSES, "ACTIVE"]).optional().catch(undefined),
});

export default function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Document library" description="Upload contracts, track processing, and open a document to ask questions or review risks." />
      <UploadDropzone maxMb={getEnv().MAX_UPLOAD_MB} />
      <Card>
        <div className="border-b border-line px-5 py-3">
          <Suspense fallback={<Skeleton className="h-9 w-full" />}>
            <LibraryFilters />
          </Suspense>
        </div>
        <Suspense fallback={<TableSkeleton />}>
          <DocumentTable searchParams={searchParams} />
        </Suspense>
      </Card>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

async function DocumentTable({ searchParams }: { searchParams: PageProps<"/documents">["searchParams"] }) {
  const user = await requirePageUser();
  const raw = await searchParams;
  const filter = filterSchema.parse({ q: typeof raw.q === "string" ? raw.q : undefined, status: typeof raw.status === "string" ? raw.status : undefined });
  const docs = await listDocuments(user.id, { query: filter.q, status: filter.status });
  const anyActive = docs.some((d) => ACTIVE_DOCUMENT_STATUSES.includes(d.status));

  if (docs.length === 0) {
    const filtered = Boolean(filter.q || filter.status);
    return filtered ? (
      <EmptyState icon={<FileSearch className="size-5" />} title="No matching documents" description="Try a different search term or status filter." />
    ) : (
      <EmptyState icon={<FileStack className="size-5" />} title="Your library is empty" description="Upload a contract above. Processing runs in the background and this list updates automatically." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <AutoRefresh active={anyActive} />
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface-muted/50 text-xs font-medium uppercase tracking-wider text-ink-subtle">
          <tr>
            <th scope="col" className="px-5 py-2.5 font-medium">Document</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Uploaded</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Last analyzed</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {docs.map((d) => (
            <tr key={d.id} className="align-middle hover:bg-surface-muted/40">
              <td className="max-w-xs px-5 py-3">
                <Link href={`/documents/${d.id}`} className="block truncate font-medium text-ink hover:text-accent">
                  {d.title}
                </Link>
                <span className="block truncate text-xs text-ink-subtle">
                  {d.originalFilename} · {formatBytes(d.sizeBytes)}
                  {d.pageCount ? ` · ${d.pageCount} pages` : ""}
                </span>
                {d.status === "FAILED" && d.errorMessage && <span className="mt-1 block text-xs text-danger">{d.errorMessage}</span>}
                {d.status !== "FAILED" && d.errorMessage && <span className="mt-1 block text-xs text-warn">{d.errorMessage}</span>}
              </td>
              <td className="px-3 py-3">
                <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase text-ink-muted">{d.fileType}</span>
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-ink-muted">{formatDate(d.createdAt)}</td>
              <td className="px-3 py-3">
                <DocumentStatusBadge status={d.status} />
              </td>
              <td className="px-3 py-3 whitespace-nowrap text-ink-muted">{formatDate(d.lastAnalyzedAt)}</td>
              <td className="px-5 py-3">
                <div className="flex items-center justify-end gap-1.5">
                  {d.status === "COMPLETED" && (
                    <>
                      <ButtonLink href={`/documents/${d.id}`} variant="secondary" size="sm">
                        Open
                      </ButtonLink>
                      <ButtonLink href={`/documents/${d.id}/risk`} variant="ghost" size="sm">
                        <ShieldCheck className="size-3.5" aria-hidden />
                        Risks
                      </ButtonLink>
                    </>
                  )}
                  {d.status === "FAILED" && <RetryButton documentId={d.id} />}
                  <DeleteButton documentId={d.id} title={d.title} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
