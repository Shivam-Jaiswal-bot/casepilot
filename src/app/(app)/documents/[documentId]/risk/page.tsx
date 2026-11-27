import { Building2, CalendarDays, FileSearch, ListChecks, Loader, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { FindingsList } from "@/components/risk/findings-list";
import { CoverageGrid, RiskSummary } from "@/components/risk/risk-overview";
import { StartAnalysisForm } from "@/components/risk/start-analysis";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Card, CardHeader, Disclaimer, EmptyState, MetaList, PageHeader, Skeleton } from "@/components/ui/primitives";
import { CLAUSE_CATEGORIES, CLAUSE_CATEGORY_LABELS } from "@/lib/domain";
import { formatDateTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { loadOwnedDocument } from "@/server/documents/load-owned-document";
import { getLatestAnalysisForDocument } from "@/server/risk/risk-service";

export const metadata: Metadata = { title: "Risk analysis" };

export default function RiskPage({ params }: PageProps<"/documents/[documentId]/risk">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<RiskSkeleton />}>
        <RiskContent params={params} />
      </Suspense>
    </div>
  );
}

function RiskSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading risk analysis">
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-10 w-96" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

async function RiskContent({ params }: Pick<PageProps<"/documents/[documentId]/risk">, "params">) {
  const user = await requirePageUser();
  const { documentId } = await params;
  const doc = await loadOwnedDocument(user.id, documentId);
  const latest = await getLatestAnalysisForDocument(user.id, doc.id);

  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Documents", href: "/documents" },
        { label: doc.title, href: `/documents/${doc.id}` },
        { label: "Risk analysis" },
      ]}
    />
  );
  const workspaceLink = (
    <ButtonLink href={`/documents/${doc.id}`} variant="secondary">
      <FileSearch aria-hidden /> Open workspace
    </ButtonLink>
  );

  if (doc.status !== "COMPLETED") {
    return (
      <>
        {crumbs}
        <PageHeader eyebrow={doc.title} title="Contract risk analysis" />
        <Alert kind="info" title="Not ready yet">
          This document must finish processing before it can be analysed.
        </Alert>
      </>
    );
  }

  if (!latest) {
    return (
      <>
        {crumbs}
        <PageHeader
          eyebrow={doc.title}
          title="Contract risk analysis"
          description="CasePilot reviews each clause category, retrieves the supporting text, and flags a risk only where it can quote the contract."
          actions={workspaceLink}
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card className="p-6 lg:col-span-3">
            <h2 className="font-serif text-xl font-semibold text-ink">Run a risk review</h2>
            <p className="mt-1.5 mb-5 text-sm leading-relaxed text-ink-muted">
              Tell CasePilot whose side you are on to get severities from that party&apos;s point of view. Leave it blank for a neutral review.
            </p>
            <StartAnalysisForm documentId={doc.id} />
            <Disclaimer className="mt-5 border-t border-line pt-4" />
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader icon={<ListChecks />} title="What is reviewed" description={`${CLAUSE_CATEGORIES.length} clause categories`} />
            <ul className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 py-4 text-[0.8125rem] text-ink-muted sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {CLAUSE_CATEGORIES.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="size-1 rounded-full bg-brass" aria-hidden />
                  {CLAUSE_CATEGORY_LABELS[c]}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </>
    );
  }

  const { analysis, findings } = latest;
  const running = analysis.status === "QUEUED" || analysis.status === "RUNNING";

  if (running || analysis.status === "FAILED") {
    return (
      <>
        {crumbs}
        <PageHeader eyebrow={doc.title} title="Contract risk analysis" actions={workspaceLink} />
        <AutoRefresh active={running} />
        <Card>
          {running ? (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-line bg-surface shadow-sm">
                <Loader className="size-5 animate-spin text-accent" aria-hidden />
              </div>
              <h2 className="mt-4 font-serif text-xl font-semibold text-ink">{analysis.status === "QUEUED" ? "Analysis queued" : "Analysis in progress"}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
                Reviewing {CLAUSE_CATEGORIES.length} clause categories against retrieved evidence. This usually takes a minute or two; the page updates automatically.
              </p>
              <div className="mx-auto mt-6 h-1 max-w-xs overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                <div className="h-full w-1/3 animate-shimmer rounded-full bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] bg-[length:200%_100%]" />
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<TriangleAlert className="text-danger" />}
              title="Analysis failed"
              description={analysis.errorMessage ?? "The analysis could not be completed."}
              action={<StartAnalysisForm documentId={doc.id} label="Try again" compact />}
            />
          )}
        </Card>
      </>
    );
  }

  const counts = analysis.severityCounts!;
  const coverage = analysis.categoryCoverage;
  const identified = coverage.filter((c) => c.outcome === "IDENTIFIED").length;
  const errored = coverage.filter((c) => c.outcome === "ERROR").length;
  const discarded = coverage.reduce((n, c) => n + c.discardedFindings, 0);

  return (
    <>
      {crumbs}
      <PageHeader
        eyebrow={doc.title}
        title="Contract risk analysis"
        meta={
          <MetaList
            items={[
              <span key="c" className="inline-flex items-center gap-1.5"><CalendarDays aria-hidden />Completed {formatDateTime(analysis.completedAt)}</span>,
              analysis.perspective ? <span key="p" className="inline-flex items-center gap-1.5"><UserRound aria-hidden />{analysis.perspective}</span> : <span key="p">Neutral perspective</span>,
            ]}
          />
        }
        actions={workspaceLink}
      />

      <div className="space-y-6">
        <section aria-label="Risk overview" className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
          <Card className="p-6 lg:col-span-2">
            <RiskSummary counts={counts} findingCount={findings.length} identified={identified} categoryCount={coverage.length} />
            {(errored > 0 || discarded > 0) && (
              <div className="mt-5 space-y-2">
                {errored > 0 && (
                  <Alert kind="warning" title="Manual review needed">
                    {pluralize(errored, "category", "categories")} could not be evaluated.
                  </Alert>
                )}
                {discarded > 0 && (
                  <Alert kind="info">
                    {pluralize(discarded, "candidate finding")} {discarded === 1 ? "was" : "were"} discarded because the quoted evidence could not be located in the contract.
                  </Alert>
                )}
              </div>
            )}
          </Card>

          <Card className="flex flex-col">
            <CardHeader icon={<Building2 />} title="Contract profile" />
            {analysis.profile ? (
              <dl className="flex-1 space-y-4 px-5 py-4 text-sm">
                <div>
                  <dt className="eyebrow">Type</dt>
                  <dd className="mt-1 font-medium text-ink">{analysis.profile.contractType ?? "Not stated"}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Parties</dt>
                  <dd className="mt-1 text-ink">
                    {analysis.profile.parties.length ? (
                      <ul className="space-y-0.5">
                        {analysis.profile.parties.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    ) : (
                      "Not identified"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Summary</dt>
                  <dd className="mt-1 leading-relaxed text-ink-muted">{analysis.profile.summary}</dd>
                </div>
              </dl>
            ) : (
              <p className="flex-1 px-5 py-4 text-sm text-ink-muted">Profile unavailable.</p>
            )}
            <div className="border-t border-line bg-surface-muted/50 px-5 py-4">
              <p className="mb-2 text-xs font-medium text-ink-muted">Re-run with a different perspective</p>
              <StartAnalysisForm documentId={doc.id} label="Re-run" compact />
            </div>
          </Card>
        </section>

        <Card>
          <CardHeader
            icon={<ShieldCheck />}
            title="Risk findings"
            description="Ordered by severity. Each finding quotes the contract — open one to inspect its evidence in the document."
          />
          {findings.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldCheck />}
              title="No risks flagged"
              description="Review the clause coverage below — categories that were not identified may still warrant a manual check."
            />
          ) : (
            <FindingsList
              documentId={doc.id}
              findings={findings.map((f) => ({
                id: f.id,
                category: f.category,
                title: f.title,
                severity: f.severity,
                explanation: f.explanation,
                confidence: f.confidence,
                basis: f.basis,
                evidence: f.evidence,
              }))}
            />
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            icon={<ListChecks />}
            title="Clause coverage"
            description={`${identified} of ${coverage.length} categories identified. "Not identified" means no matching provision was found in the reviewed content — it is not, by itself, a defect.`}
          />
          <CoverageGrid coverage={coverage} />
        </Card>
        <Disclaimer />
      </div>
    </>
  );
}
