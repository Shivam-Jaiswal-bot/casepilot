import { AlertOctagon, CheckCircle2, FileStack, Loader, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { DocumentStatusBadge, SEVERITY_DOT, SEVERITY_LABEL } from "@/components/ui/domain-badges";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, StatCard } from "@/components/ui/primitives";
import { RISK_SEVERITIES } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { getDashboardStats, listDocuments } from "@/server/documents/document-service";
import { listRecentAnalyses } from "@/server/risk/risk-service";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        description="Overview of your contract library, processing activity and recent risk reviews."
        actions={<ButtonLink href="/documents">Upload contracts</ButtonLink>}
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 lg:col-span-3" />
        <Skeleton className="h-72 lg:col-span-2" />
      </div>
    </div>
  );
}

async function DashboardContent() {
  const user = await requirePageUser();
  const [stats, recentDocs, analyses] = await Promise.all([
    getDashboardStats(user.id),
    listDocuments(user.id, { limit: 6 }),
    listRecentAnalyses(user.id, 6),
  ]);
  const busy = stats.processing > 0 || analyses.some((a) => a.status === "QUEUED" || a.status === "RUNNING");

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} intervalMs={4000} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Documents" value={stats.total} hint="Uploaded to your library" icon={<FileStack className="size-4" />} />
        <StatCard label="Ready" value={stats.completed} hint="Indexed and searchable" icon={<CheckCircle2 className="size-4" />} />
        <StatCard label="Processing" value={stats.processing} hint="Queued, extracting or indexing" icon={<Loader className="size-4" />} tone={stats.processing ? "warn" : undefined} />
        <StatCard
          label="Failed jobs"
          value={stats.failedJobs}
          hint={stats.failed ? `${stats.failed} document${stats.failed === 1 ? "" : "s"} need attention` : "No documents need attention"}
          icon={<AlertOctagon className="size-4" />}
          tone={stats.failedJobs ? "danger" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent documents" action={<Link href="/documents" className="text-sm font-medium text-accent hover:underline">View all</Link>} />
          {recentDocs.length === 0 ? (
            <EmptyState
              icon={<FileStack className="size-5" />}
              title="No documents yet"
              description="Upload a PDF or Word contract to start asking questions and reviewing risks."
              action={<ButtonLink href="/documents">Upload a contract</ButtonLink>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentDocs.map((d) => (
                <li key={d.id}>
                  <Link href={`/documents/${d.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-muted/60">
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase text-ink-muted">{d.fileType}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{d.title}</span>
                      <span className="block text-xs text-ink-subtle">Uploaded {formatDate(d.createdAt)}</span>
                    </span>
                    <DocumentStatusBadge status={d.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent risk analyses" />
          {analyses.length === 0 ? (
            <EmptyState icon={<ShieldAlert className="size-5" />} title="No analyses yet" description="Open a processed document and run a contract risk analysis." />
          ) : (
            <ul className="divide-y divide-line">
              {analyses.map((a) => (
                <li key={a.id}>
                  <Link href={`/documents/${a.documentId}/risk`} className="block px-5 py-3 hover:bg-surface-muted/60">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-ink">{a.documentTitle}</span>
                      {a.status === "COMPLETED" ? (
                        <span className="text-xs text-ink-subtle">{formatDateTime(a.completedAt)}</span>
                      ) : (
                        <Badge tone={a.status === "FAILED" ? "danger" : "accent"}>{a.status === "FAILED" ? "Failed" : "Running"}</Badge>
                      )}
                    </div>
                    {a.severityCounts && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        {RISK_SEVERITIES.filter((s) => a.severityCounts![s] > 0).map((s) => (
                          <span key={s} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                            <span className={`size-1.5 rounded-full ${SEVERITY_DOT[s]}`} aria-hidden />
                            {a.severityCounts![s]} {SEVERITY_LABEL[s].toLowerCase()}
                          </span>
                        ))}
                        {RISK_SEVERITIES.every((s) => a.severityCounts![s] === 0) && <span className="text-xs text-ink-muted">No findings flagged</span>}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
