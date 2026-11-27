import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EvidenceInspector } from "@/components/risk/evidence-inspector";
import { SeverityBadge } from "@/components/ui/domain-badges";
import { Badge, Card, Disclaimer, PageHeader, Skeleton } from "@/components/ui/primitives";
import { CLAUSE_CATEGORY_LABELS } from "@/lib/domain";
import { requirePageUser } from "@/server/auth/session";
import { getDocumentSegments } from "@/server/documents/document-service";
import { loadOwnedDocument } from "@/server/documents/load-owned-document";
import { AppError } from "@/server/errors";
import { getFinding } from "@/server/risk/risk-service";

export const metadata: Metadata = { title: "Risk finding" };

export default function FindingPage({ params }: PageProps<"/documents/[documentId]/risk/findings/[findingId]">) {
  return (
    <div className="mx-auto max-w-[1500px]">
      <Suspense fallback={<Skeleton className="h-[70vh] w-full" />}>
        <FindingContent params={params} />
      </Suspense>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{title}</h2>
      <div className="mt-1.5 text-sm leading-relaxed text-ink">{children}</div>
    </div>
  );
}

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

  return (
    <>
      <Link href={`/documents/${doc.id}/risk`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Risk analysis · {doc.title}
      </Link>
      <PageHeader
        eyebrow={CLAUSE_CATEGORY_LABELS[finding.category]}
        title={finding.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <Badge tone="neutral">{finding.basis === "EXPLICIT" ? "Explicit in contract text" : "Interpretation of contract text"}</Badge>
            <Badge tone="neutral">Confidence: {finding.confidence.toLowerCase()}</Badge>
          </span>
        }
      />
      <div className="space-y-6">
        <Card className="grid gap-6 p-6 md:grid-cols-3">
          <Section title="Why it was flagged">{finding.explanation}</Section>
          <Section title="Potential implications">{finding.businessImplication}</Section>
          <Section title="Suggested legal review">{finding.reviewSuggestion}</Section>
          {finding.severityRationale ? (
            <div className="md:col-span-3">
              <Section title="How the severity was assessed">
                {`Direction: ${finding.severityRationale.direction.toLowerCase()} · exposure: ${finding.severityRationale.exposure.toLowerCase()} · market position: ${finding.severityRationale.marketPosition.toLowerCase()}.`}
                {finding.severityRationale.adjusted
                  ? ` The model proposed ${finding.severityRationale.modelSeverity.toLowerCase()}; it was adjusted to ${finding.severity.toLowerCase()} to stay consistent with these factors.`
                  : null}
              </Section>
            </div>
          ) : null}
        </Card>
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">Source evidence</h2>
          <EvidenceInspector
            document={{ id: doc.id, title: doc.title, fileType: doc.fileType, pageCount: doc.pageCount }}
            segments={segments}
            evidence={finding.evidence}
            chunkText={Object.fromEntries(chunkText)}
          />
        </div>
        <Disclaimer />
      </div>
    </>
  );
}
