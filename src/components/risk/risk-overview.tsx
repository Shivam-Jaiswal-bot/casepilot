import { CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { SEVERITY_DOT, SEVERITY_LABEL, SEVERITY_TEXT, SeverityBar } from "@/components/ui/domain-badges";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CLAUSE_CATEGORY_LABELS, RISK_SEVERITIES, type CategoryCoverage, type SeverityCounts } from "@/lib/domain";
import { pluralize } from "@/lib/format";

/**
 * Presentational building blocks for the risk analysis overview. They only
 * display what the analysis produced: counts per severity, coverage per
 * clause category and the contract profile. No composite score is derived.
 */

export function SeverityTiles({ counts }: { counts: SeverityCounts }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {RISK_SEVERITIES.map((s) => {
        const n = counts[s];
        return (
          <div
            key={s}
            className={cn(
              "relative overflow-hidden rounded-lg border px-3.5 py-3 transition-colors",
              n > 0 ? "border-line bg-surface" : "border-line/70 bg-surface-muted/50",
              s === "INFORMATIONAL" && "col-span-2 sm:col-span-1",
            )}
          >
            <span className={cn("absolute inset-x-0 top-0 h-0.5", n > 0 ? SEVERITY_DOT[s] : "bg-transparent")} aria-hidden />
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[s], n === 0 && "opacity-40")} aria-hidden />
              {SEVERITY_LABEL[s]}
            </div>
            <div className={cn("num mt-1.5 font-serif text-[1.75rem] leading-none font-semibold", n > 0 ? SEVERITY_TEXT[s] : "text-ink-subtle/70")}>{n}</div>
          </div>
        );
      })}
    </div>
  );
}

export function RiskSummary({
  counts,
  findingCount,
  identified,
  categoryCount,
}: {
  counts: SeverityCounts;
  findingCount: number;
  identified: number;
  categoryCount: number;
}) {
  const highest = RISK_SEVERITIES.find((s) => counts[s] > 0);
  const elevated = counts.CRITICAL + counts.HIGH;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Highest severity</div>
          <div className={cn("mt-1.5 font-serif text-[1.875rem] leading-none font-semibold", highest ? SEVERITY_TEXT[highest] : "text-ok")}>
            {highest ? SEVERITY_LABEL[highest] : "No risks flagged"}
          </div>
        </div>
        <dl className="flex gap-6 text-right">
          <div>
            <dt className="text-xs text-ink-subtle">Findings</dt>
            <dd className="num mt-0.5 text-lg font-semibold text-ink">{findingCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Critical + high</dt>
            <dd className="num mt-0.5 text-lg font-semibold text-ink">{elevated}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Clauses identified</dt>
            <dd className="num mt-0.5 text-lg font-semibold text-ink">
              {identified}
              <span className="text-sm font-normal text-ink-subtle">/{categoryCount}</span>
            </dd>
          </div>
        </dl>
      </div>
      <SeverityBar counts={counts} className="mt-5" />
      <div className="mt-4">
        <SeverityTiles counts={counts} />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-ink-subtle">
        {findingCount === 0 ? "No risks were flagged in the reviewed content. " : `${pluralize(findingCount, "finding")} across ${identified} identified clause categories. `}
        No composite score is computed: severity levels are qualitative legal judgements that do not add up meaningfully.
      </p>
    </div>
  );
}

const OUTCOME: Record<CategoryCoverage["outcome"], { label: string; tone: "ok" | "neutral" | "danger"; Icon: typeof CheckCircle2; icon: string }> = {
  IDENTIFIED: { label: "Identified", tone: "ok", Icon: CheckCircle2, icon: "text-ok" },
  NOT_IDENTIFIED: { label: "Not identified", tone: "neutral", Icon: CircleDashed, icon: "text-ink-subtle" },
  ERROR: { label: "Not evaluated", tone: "danger", Icon: TriangleAlert, icon: "text-danger" },
};

export function CoverageGrid({ coverage }: { coverage: CategoryCoverage[] }) {
  return (
    <ul className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
      {coverage.map((c) => {
        const o = OUTCOME[c.outcome];
        return (
          <li key={c.category} className="bg-surface px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <o.Icon className={cn("size-4 shrink-0", o.icon)} aria-hidden />
                <span className="truncate text-sm font-medium text-ink">{CLAUSE_CATEGORY_LABELS[c.category]}</span>
              </div>
              {c.outcome === "IDENTIFIED" && c.findingCount > 0 ? (
                <Badge tone="accent">{pluralize(c.findingCount, "finding")}</Badge>
              ) : (
                <span className="sr-only">{o.label}</span>
              )}
            </div>
            <p className="mt-1.5 line-clamp-3 pl-6 text-xs leading-relaxed text-ink-muted">{c.summary || o.label}</p>
          </li>
        );
      })}
    </ul>
  );
}
