import { ArrowRight, Gavel, Lightbulb, Scale, Search } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { EvidenceInspector } from "@/components/risk/evidence-inspector";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { SEVERITY_LABEL, SeverityBadge } from "@/components/ui/domain-badges";
import { AiLabel, Badge, Card, Disclaimer, PageHeader, Skeleton } from "@/components/ui/primitives";
import { CLAUSE_CATEGORY_LABELS } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { getDocumentSegments } from "@/server/documents/document-service";
import { loadOwnedDocument } from "@/server/documents/load-owned-document";
import { AppError } from "@/server/errors";
import { getFinding } from "@/server/risk/risk-service";

export const metadata: Metadata = { title: "Risk finding" };

export default function FindingPage({ params }: PageProps<"/documents/[documentId]/risk/findings/[findingId]">) {
  return (
    <div className="mx-auto max-w-[1500px]">
      <Suspense fallback={<FindingSkeleton />}>
        <FindingContent params={params} />
      </Suspense>
    </div>
  );
}

function FindingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading finding">
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-[60vh] rounded-xl" />
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink [&_svg]:size-3.5 [&_svg]:text-ink-subtle">
        {icon}
        {title}
      </h2>
      <div className="mt-2 text-[0.875rem] leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

const lower = (s: string) => s.toLowerCase();

async function FindingContent({ params }: Pick<PageProps<"/documents/[documentId]/risk/findings/[findingId]">, "params">) {
  const user = await requirePageUser();
  const { documentId, findingId } = await params;
  const doc = await loadOwnedDocument(user.id, documentId);
  const result = await getFinding(user.id, findingId).catch((err: unknown) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  const { finding, chunkText } = result;
  if (finding.documentId !== doc.id) notFound();
  const segments = await getDocumentSegments(user.id, doc.id);
  const rationale = finding.severityRationale;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Documents", href: "/documents" },
          { label: doc.title, href: `/documents/${doc.id}` },
          { label: "Risk analysis", href: `/documents/${doc.id}/risk` },
          { label: CLAUSE_CATEGORY_LABELS[finding.category] },
        ]}
      />
      <PageHeader
        eyebrow={CLAUSE_CATEGORY_LABELS[finding.category]}
        title={finding.title}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <Badge tone="neutral">{finding.basis === "EXPLICIT" ? "Explicit in contract text" : "Interpretation of contract text"}</Badge>
            <Badge tone="neutral">Confidence: {lower(finding.confidence)}</Badge>
            <Badge tone="neutral">{pluralize(finding.evidence.length, "evidence quote")}</Badge>
          </div>
        }
      />

      <div className="space-y-8">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
            <AiLabel />
            <span className="text-xs text-ink-subtle">Generated from the quoted evidence below — verify before relying on it.</span>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 p-6 md:grid-cols-3">
            <Section icon={<Search />} title="Why it was flagged">
              {finding.explanation}
            </Section>
            <Section icon={<Scale />} title="Potential implications">
              {finding.businessImplication}
            </Section>
            <Section icon={<Lightbulb />} title="Suggested legal review">
              {finding.reviewSuggestion}
            </Section>
          </div>
          {rationale && (
            <div className="border-t border-line bg-surface-muted/50 px-6 py-4">
              <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
                <Gavel className="size-3.5 text-ink-subtle" aria-hidden />
                How the severity was assessed
              </h2>
              <dl className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["Direction", rationale.direction],
                    ["Exposure", rationale.exposure],
                    ["Market position", rationale.marketPosition],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs">
                    <dt className="text-ink-subtle">{k}</dt>
                    <dd className="font-medium text-ink capitalize">{lower(v)}</dd>
                  </div>
                ))}
              </dl>
              {rationale.adjusted && (
                <p className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  Model proposed <span className="font-medium text-ink">{SEVERITY_LABEL[rationale.modelSeverity]}</span>
                  <ArrowRight className="size-3" aria-hidden />
                  adjusted to <span className="font-medium text-ink">{SEVERITY_LABEL[finding.severity]}</span> to stay consistent with these factors.
                </p>
              )}
            </div>
          )}
        </Card>

        <section aria-labelledby="evidence-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="evidence-heading" className="font-serif text-xl font-semibold text-ink">
                Contract evidence
              </h2>
              <p className="mt-1 text-[0.8125rem] text-ink-muted">Exact quotations located in the document. Select one to view it in place.</p>
            </div>
          </div>
          <EvidenceInspector
            document={{ id: doc.id, title: doc.title, fileType: doc.fileType, pageCount: doc.pageCount }}
            segments={segments}
            evidence={finding.evidence}
            chunkText={Object.fromEntries(chunkText)}
          />
        </section>
        <Disclaimer />
      </div>
    </>
  );
}
