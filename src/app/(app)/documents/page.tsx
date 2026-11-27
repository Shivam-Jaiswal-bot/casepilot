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
import { FileIcon } from "@/components/ui/file-icon";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { ACTIVE_DOCUMENT_STATUSES, DOCUMENT_STATUSES } from "@/lib/domain";
import { formatBytes, formatDate, pluralize } from "@/lib/format";
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
      <PageHeader
        eyebrow="Library"
        title="Documents"
        description="Upload contracts, track processing, and open a document to ask questions or review its risks."
        className="pb-1"
      />
      <UploadDropzone maxMb={getEnv().MAX_UPLOAD_MB} />
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-3.5">
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
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading documents">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-10 w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

const th = "px-3 py-2.5 text-left text-[0.6875rem] font-semibold tracking-[0.06em] text-ink-subtle uppercase";

async function DocumentTable({ searchParams }: { searchParams: PageProps<"/documents">["searchParams"] }) {
  const user = await requirePageUser();
  const raw = await searchParams;
  const filter = filterSchema.parse({ q: typeof raw.q === "string" ? raw.q : undefined, status: typeof raw.status === "string" ? raw.status : undefined });
  const docs = await listDocuments(user.id, { query: filter.q, status: filter.status });
  const anyActive = docs.some((d) => ACTIVE_DOCUMENT_STATUSES.includes(d.status));

  if (docs.length === 0) {
    const filtered = Boolean(filter.q || filter.status);
    return filtered ? (
      <EmptyState icon={<FileSearch />} title="No matching documents" description="Try a different search term or status filter." />
    ) : (
      <EmptyState icon={<FileStack />} title="Your library is empty" description="Upload a contract above. Processing runs in the background and this list updates automatically." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <AutoRefresh active={anyActive} />
      <table className="w-full text-sm">
        <caption className="sr-only">Your documents ({docs.length})</caption>
        <thead className="border-b border-line bg-surface-muted/50">
          <tr>
            <th scope="col" className={`${th} pl-5`}>
              Document
            </th>
            <th scope="col" className={`${th} hidden lg:table-cell`}>
              Uploaded
            </th>
            <th scope="col" className={th}>
              Status
            </th>
            <th scope="col" className={`${th} hidden xl:table-cell`}>
              Last analysed
            </th>
            <th scope="col" className={`${th} pr-5 text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {docs.map((d) => (
            <tr key={d.id} className="group align-middle transition-colors hover:bg-surface-muted/50">
              <td className="max-w-0 py-3.5 pr-3 pl-5 sm:max-w-md">
                <div className="flex min-w-0 items-center gap-3.5">
                  <FileIcon type={d.fileType} />
                  <div className="min-w-0">
                    <Link href={`/documents/${d.id}`} className="block truncate font-medium text-ink transition-colors hover:text-accent">
                      {d.title}
                    </Link>
                    <span className="mt-0.5 block truncate text-xs text-ink-subtle">
                      {d.originalFilename} · {formatBytes(d.sizeBytes)}
                      {d.pageCount ? ` · ${pluralize(d.pageCount, "page")}` : ""}
                    </span>
                    {d.status === "FAILED" && d.errorMessage && <span className="mt-1 block text-xs text-danger">{d.errorMessage}</span>}
                    {d.status !== "FAILED" && d.errorMessage && <span className="mt-1 block text-xs text-warn">{d.errorMessage}</span>}
                  </div>
                </div>
              </td>
              <td className="hidden px-3 py-3.5 whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(d.createdAt)}</td>
              <td className="px-3 py-3.5">
                <DocumentStatusBadge status={d.status} />
              </td>
              <td className="hidden px-3 py-3.5 whitespace-nowrap text-ink-muted xl:table-cell">{d.lastAnalyzedAt ? formatDate(d.lastAnalyzedAt) : <span className="text-ink-subtle">—</span>}</td>
              <td className="py-3.5 pr-5 pl-3">
                <div className="flex items-center justify-end gap-1.5">
                  {d.status === "COMPLETED" && (
                    <>
                      <ButtonLink href={`/documents/${d.id}`} variant="secondary" size="sm" className="max-sm:hidden">
                        Open
                      </ButtonLink>
                      <ButtonLink href={`/documents/${d.id}/risk`} variant="ghost" size="sm" aria-label={`Risk analysis for ${d.title}`}>
                        <ShieldCheck aria-hidden />
                        <span className="hidden md:inline">Risks</span>
                      </ButtonLink>
                    </>
                  )}
                  {d.status === "FAILED" && <RetryButton documentId={d.id} />}
                  <DeleteButton documentId={d.id} title={d.title} showLabel={false} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
