import { ArrowLeft, CircleDashed, Loader, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { FindingsList } from "@/components/risk/findings-list";
import { StartAnalysisForm } from "@/components/risk/start-analysis";
import { ButtonLink } from "@/components/ui/button";
import { SEVERITY_DOT, SEVERITY_LABEL } from "@/components/ui/domain-badges";
import { Alert, Badge, Card, CardHeader, Disclaimer, EmptyState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CLAUSE_CATEGORY_LABELS, RISK_SEVERITIES, type CategoryCoverage } from "@/lib/domain";
import { formatDateTime, pluralize } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { loadOwnedDocument } from "@/server/documents/load-owned-document";
import { getLatestAnalysisForDocument } from "@/server/risk/risk-service";

export const metadata: Metadata = { title: "Risk analysis" };

export default function RiskPage({ params }: PageProps<"/documents/[documentId]/risk">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
        <RiskContent params={params} />
      </Suspense>
    </div>
  );
}

const OUTCOME_META: Record<CategoryCoverage["outcome"], { label: string; tone: "ok" | "neutral" | "danger" }> = {
  IDENTIFIED: { label: "Identified", tone: "ok" },
  NOT_IDENTIFIED: { label: "Not identified", tone: "neutral" },
  ERROR: { label: "Not evaluated", tone: "danger" },
};

async function RiskContent({ params }: Pick<PageProps<"/documents/[documentId]/risk">, "params">) {
  const user = await requirePageUser();
  const { documentId } = await params;
  const doc = await loadOwnedDocument(user.id, documentId);
  const latest = await getLatestAnalysisForDocument(user.id, doc.id);

  const back = (
    <Link href={`/documents/${doc.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
      <ArrowLeft className="size-3.5" aria-hidden /> {doc.title}
    </Link>
  );

  if (doc.status !== "COMPLETED") {
    return (
      <>
        {back}
        <PageHeader title="Risk analysis" eyebrow={doc.title} />
        <Alert kind="info">This document must finish processing before it can be analysed.</Alert>
      </>
    );
  }

  if (!latest) {
    return (
      <>
        {back}
        <PageHeader title="Contract risk analysis" eyebrow={doc.title} description="CasePilot reviews 15 clause categories, retrieves the supporting text for each, and flags risks only where it can quote the contract." />
        <Card className="max-w-2xl p-6">
          <StartAnalysisForm documentId={doc.id} />
          <Disclaimer className="mt-4" />
        </Card>
      </>
    );
  }

  const { analysis, findings } = latest;
  const running = analysis.status === "QUEUED" || analysis.status === "RUNNING";

  if (running || analysis.status === "FAILED") {
    return (
      <>
        {back}
        <PageHeader title="Contract risk analysis" eyebrow={doc.title} />
        <AutoRefresh active={running} />
        <Card>
          <EmptyState
            icon={running ? <Loader className="size-5 animate-spin" /> : <TriangleAlert className="size-5" />}
            title={running ? "Analysis in progress" : "Analysis failed"}
            description={running ? "Reviewing each clause category against retrieved evidence. This page updates automatically." : (analysis.errorMessage ?? "The analysis could not be completed.")}
            action={running ? undefined : <StartAnalysisForm documentId={doc.id} label="Try again" compact />}
          />
        </Card>
      </>
    );
  }

  const counts = analysis.severityCounts!;
  const coverage = analysis.categoryCoverage;
  const identified = coverage.filter((c) => c.outcome === "IDENTIFIED").length;
  const notIdentified = coverage.filter((c) => c.outcome === "NOT_IDENTIFIED");
  const errored = coverage.filter((c) => c.outcome === "ERROR").length;
  const discarded = coverage.reduce((n, c) => n + c.discardedFindings, 0);
  const highest = RISK_SEVERITIES.find((s) => counts[s] > 0);

  return (
    <>
      {back}
      <PageHeader
        title="Contract risk analysis"
        eyebrow={doc.title}
        description={`Completed ${formatDateTime(analysis.completedAt)}${analysis.perspective ? ` · Perspective: ${analysis.perspective}` : ""}`}
        actions={<ButtonLink href={`/documents/${doc.id}`} variant="secondary">Open workspace</ButtonLink>}
      />

      <div className="space-y-6">
        <section aria-label="Risk overview" className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-ink">Overview</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {findings.length === 0
                ? "No risks were flagged in the reviewed content."
                : `${pluralize(findings.length, "finding")} across ${identified} identified clause categories. Highest severity: ${SEVERITY_LABEL[highest!].toLowerCase()}.`}{" "}
              Findings are listed by severity; no composite numerical score is computed, because severity levels are qualitative legal judgements that do not add up meaningfully.
            </p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {RISK_SEVERITIES.map((s) => (
                <div key={s} className="rounded-md border border-line bg-surface-muted/40 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wider text-ink-subtle">
                    <span className={cn("size-2 rounded-full", SEVERITY_DOT[s])} aria-hidden />
                    <span className="truncate">{SEVERITY_LABEL[s]}</span>
                  </div>
                  <div className="mt-1 font-serif text-2xl font-semibold tabular-nums text-ink">{counts[s]}</div>
                </div>
              ))}
            </div>
            {(errored > 0 || discarded > 0) && (
              <div className="mt-4 space-y-2">
                {errored > 0 && <Alert kind="warning">{pluralize(errored, "category", "categories")} could not be evaluated and should be reviewed manually.</Alert>}
                {discarded > 0 && (
                  <Alert kind="info">
                    {pluralize(discarded, "candidate finding")} {discarded === 1 ? "was" : "were"} discarded because the quoted evidence could not be located in the contract.
                  </Alert>
                )}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">Contract profile</h2>
            {analysis.profile ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-ink-subtle">Type</dt>
                  <dd className="text-ink">{analysis.profile.contractType ?? "Not stated"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Parties</dt>
                  <dd className="text-ink">{analysis.profile.parties.length ? analysis.profile.parties.join("; ") : "Not identified"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Summary</dt>
                  <dd className="text-ink-muted">{analysis.profile.summary}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Profile unavailable.</p>
            )}
            <div className="mt-4 border-t border-line pt-4">
              <StartAnalysisForm documentId={doc.id} label="Re-run" compact />
            </div>
          </Card>
        </section>

        <Card>
          <CardHeader title="Risk findings" description="Each finding quotes the contract. Open one to inspect its evidence against the document." />
          {findings.length === 0 ? (
            <EmptyState icon={<ShieldCheck className="size-5" />} title="No risks flagged" description="Review the clause coverage below — categories that were not identified may still warrant a manual check." />
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

        <Card>
          <CardHeader
            title="Clause coverage"
            description={`${identified} of ${coverage.length} categories identified. "Not identified" means no matching provision was found in the reviewed content — it is not, by itself, a defect.`}
          />
          <ul className="grid divide-line sm:grid-cols-2 lg:grid-cols-3">
            {coverage.map((c) => (
              <li key={c.category} className="border-b border-line px-5 py-3 sm:[&:nth-child(odd)]:border-r lg:[&:nth-child(odd)]:border-r-0 lg:[&:not(:nth-child(3n))]:border-r">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{CLAUSE_CATEGORY_LABELS[c.category]}</span>
                  <Badge tone={OUTCOME_META[c.outcome].tone}>
                    {c.outcome === "NOT_IDENTIFIED" && <CircleDashed className="size-3" aria-hidden />}
                    {OUTCOME_META[c.outcome].label}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {c.outcome === "IDENTIFIED" && c.findingCount > 0 ? `${pluralize(c.findingCount, "finding")} · ` : ""}
                  {c.summary}
                </p>
              </li>
            ))}
          </ul>
          {notIdentified.length > 0 && (
            <p className="px-5 py-3 text-xs text-ink-subtle">
              Not identified: {notIdentified.map((c) => CLAUSE_CATEGORY_LABELS[c.category]).join(", ")}.
            </p>
          )}
        </Card>
        <Disclaimer />
      </div>
    </>
  );
}
