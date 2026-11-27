import { AlertOctagon, ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, CloudUpload, FileStack, Loader, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { ButtonLink } from "@/components/ui/button";
import { DocumentStatusBadge, SeverityBadge, SeverityBar, SeverityLegend } from "@/components/ui/domain-badges";
import { FileIcon } from "@/components/ui/file-icon";
import { Badge, Card, CardHeader, EmptyState, MetricCard, PageHeader, Skeleton, Spinner } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { RISK_SEVERITIES } from "@/lib/domain";
import { formatBytes, formatDate, formatDateTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { getDashboardStats, listDocuments } from "@/server/documents/document-service";
import { listRecentAnalyses } from "@/server/risk/risk-service";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Overview"
        title="Contract intelligence"
        description="The state of your contract library at a glance: what is ready to query, what is still processing, and what your latest risk reviews found."
        actions={
          <>
            <ButtonLink href="/documents" variant="secondary">
              View library
            </ButtonLink>
            <ButtonLink href="/documents">
              <CloudUpload aria-hidden />
              Upload contracts
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[9.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 rounded-xl lg:col-span-3" />
        <Skeleton className="h-96 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
}

/** Library composition: ready / processing / failed as one proportional bar. */
function LibraryBar({ ready, processing, failed, total }: { ready: number; processing: number; failed: number; total: number }) {
  const seg = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className="mt-4 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken" role="img" aria-label={`${ready} ready, ${processing} processing, ${failed} failed`}>
      {ready > 0 && <span className="h-full rounded-full bg-ok" style={{ width: seg(ready) }} />}
      {processing > 0 && <span className="h-full rounded-full bg-warn" style={{ width: seg(processing) }} />}
      {failed > 0 && <span className="h-full rounded-full bg-danger" style={{ width: seg(failed) }} />}
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
  const readyPct = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} intervalMs={4000} />

      <section aria-label="Library metrics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total documents"
          value={stats.total}
          icon={<FileStack />}
          status={stats.total ? `${pluralize(stats.completedAnalyses, "completed risk analysis", "completed risk analyses")}` : "No contracts uploaded yet"}
          footer={stats.total > 0 ? <LibraryBar ready={stats.completed} processing={stats.processing} failed={stats.failed} total={stats.total} /> : undefined}
        />
        <MetricCard
          label="Ready"
          value={stats.completed}
          icon={<CheckCircle2 />}
          tone={stats.completed ? "ok" : "neutral"}
          status={stats.total ? `${readyPct}% of library indexed and searchable` : "Indexed documents appear here"}
        />
        <MetricCard
          label="Processing"
          value={stats.processing}
          icon={<Loader />}
          tone={stats.processing ? "warn" : "neutral"}
          live={stats.processing > 0}
          status={stats.processing ? "Queued, extracting or indexing" : "Nothing in progress"}
        />
        <MetricCard
          label="Failed jobs"
          value={stats.failedJobs}
          icon={<AlertOctagon />}
          tone={stats.failedJobs ? "danger" : "neutral"}
          status={stats.failed ? `${pluralize(stats.failed, "document")} need${stats.failed === 1 ? "s" : ""} attention` : "No documents need attention"}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="flex flex-col lg:col-span-3">
          <CardHeader
            title="Recent documents"
            description="Latest uploads and their processing status."
            action={
              recentDocs.length > 0 ? (
                <Link href="/documents" className="group inline-flex items-center gap-1 text-[0.8125rem] font-medium text-accent">
                  View all
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              ) : undefined
            }
          />
          {recentDocs.length === 0 ? (
            <EmptyState
              icon={<FileStack />}
              title="Your library is empty"
              description="Upload a PDF or Word contract. CasePilot extracts, sections and indexes it so you can ask questions and run a risk review."
              action={
                <ButtonLink href="/documents">
                  <CloudUpload aria-hidden />
                  Upload your first contract
                </ButtonLink>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentDocs.map((d) => (
                <li key={d.id} className="group relative flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-muted/70">
                  <FileIcon type={d.fileType} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/documents/${d.id}`} className="block truncate text-sm font-medium text-ink after:absolute after:inset-0 group-hover:text-accent">
                      {d.title}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">
                      {d.fileType.toUpperCase()} · {formatBytes(d.sizeBytes)}
                      {d.pageCount ? ` · ${pluralize(d.pageCount, "page")}` : ""} · Uploaded {formatDate(d.createdAt)}
                    </p>
                    {d.status === "FAILED" && d.errorMessage && <p className="mt-1 truncate text-xs text-danger">{d.errorMessage}</p>}
                  </div>
                  <DocumentStatusBadge status={d.status} className="max-sm:hidden" />
                  {d.status === "COMPLETED" && (
                    <Tooltip content="Risk analysis" className="relative z-10 max-sm:hidden">
                      <Link
                        href={`/documents/${d.id}/risk`}
                        aria-label={`Risk analysis for ${d.title}`}
                        className="flex size-8 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface hover:text-accent hover:shadow-xs"
                      >
                        <ShieldCheck className="size-4" aria-hidden />
                      </Link>
                    </Tooltip>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-line-strong transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-ink-subtle" aria-hidden />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col lg:col-span-2">
          <CardHeader title="Risk monitor" description="Severity distribution of your latest analyses." />
          {analyses.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldAlert />}
              title="No risk analyses yet"
              description="Open a processed contract and run a risk analysis. Findings are kept only when they quote the contract."
            />
          ) : (
            <ul className="divide-y divide-line">
              {analyses.map((a) => {
                const counts = a.severityCounts;
                const highest = counts ? RISK_SEVERITIES.find((s) => counts[s] > 0) : undefined;
                const total = counts ? RISK_SEVERITIES.reduce((n, s) => n + counts[s], 0) : 0;
                return (
                  <li key={a.id}>
                    <Link href={`/documents/${a.documentId}/risk`} className="group block px-5 py-4 transition-colors hover:bg-surface-muted/70">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink group-hover:text-accent">{a.documentTitle}</p>
                          <p className="mt-0.5 text-xs text-ink-subtle">
                            {a.status === "COMPLETED" ? `Completed ${formatDateTime(a.completedAt)}` : `Started ${formatDateTime(a.createdAt)}`}
                          </p>
                        </div>
                        {a.status === "COMPLETED" ? (
                          highest ? (
                            <SeverityBadge severity={highest} />
                          ) : (
                            <Badge tone="ok">No findings</Badge>
                          )
                        ) : a.status === "FAILED" ? (
                          <Badge tone="danger">Failed</Badge>
                        ) : (
                          <Badge tone="accent">
                            <Spinner className="size-2.5 border-[1.5px]" label="Running" />
                            Running
                          </Badge>
                        )}
                      </div>
                      {a.status === "COMPLETED" && counts && (
                        <div className="mt-3">
                          <SeverityBar counts={counts} size="sm" />
                          <div className="mt-2 flex items-center justify-between gap-3">
                            {total > 0 ? <SeverityLegend counts={counts} /> : <span className="text-xs text-ink-subtle">No risks flagged in the reviewed content</span>}
                            <ArrowUpRight className="size-3.5 shrink-0 text-line-strong transition-colors group-hover:text-ink-subtle" aria-hidden />
                          </div>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
