"use client";

import { ChevronRight, Quote } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SEVERITY_DOT, SEVERITY_LABEL, SEVERITY_RULE, SeverityBadge } from "@/components/ui/domain-badges";
import { EmptyState, inputClasses } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  CLAUSE_CATEGORY_LABELS,
  formatLocation,
  RISK_SEVERITIES,
  type AssessmentBasis,
  type ClauseCategory,
  type Confidence,
  type FindingEvidence,
  type RiskSeverity,
} from "@/lib/domain";

export interface FindingListItem {
  id: string;
  category: ClauseCategory;
  title: string;
  severity: RiskSeverity;
  explanation: string;
  confidence: Confidence;
  basis: AssessmentBasis;
  evidence: FindingEvidence[];
}

const CONFIDENCE_BARS: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Three-bar confidence meter with a text label. */
function ConfidenceMeter({ confidence }: { confidence: Confidence }) {
  const filled = CONFIDENCE_BARS[confidence];
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confidence: ${confidence.toLowerCase()}`}>
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3].map((b) => (
          <span key={b} className={cn("w-[3px] rounded-[1px]", b <= filled ? "bg-ink-muted" : "bg-line-strong")} style={{ height: `${4 + b * 2}px` }} />
        ))}
      </span>
      {confidence.charAt(0) + confidence.slice(1).toLowerCase()} confidence
    </span>
  );
}

export function FindingsList({ documentId, findings }: { documentId: string; findings: FindingListItem[] }) {
  const [severity, setSeverity] = useState<RiskSeverity | "ALL">("ALL");
  const [category, setCategory] = useState<ClauseCategory | "ALL">("ALL");
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))], [findings]);
  const visible = findings.filter((f) => (severity === "ALL" || f.severity === severity) && (category === "ALL" || f.category === category));

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-line bg-surface-muted/40 px-5 py-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by severity">
          {(["ALL", ...RISK_SEVERITIES] as const).map((s) => {
            const count = s === "ALL" ? findings.length : findings.filter((f) => f.severity === s).length;
            if (s !== "ALL" && count === 0) return null;
            const active = severity === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors duration-150",
                  active ? "border-accent bg-accent text-white shadow-sm" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {s !== "ALL" && <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[s], active && "ring-1 ring-white/60")} aria-hidden />}
                {s === "ALL" ? "All" : SEVERITY_LABEL[s]}
                <span className={cn("num", active ? "text-white/75" : "text-ink-subtle")}>{count}</span>
              </button>
            );
          })}
        </div>
        <label className="sm:ml-auto">
          <span className="sr-only">Filter by clause category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as ClauseCategory | "ALL")} className={cn(inputClasses, "h-8 w-full text-xs sm:w-56")}>
            <option value="ALL">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CLAUSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState compact title="No findings match these filters" description="Clear a filter to see more findings." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((f) => (
            <li key={f.id}>
              <Link
                href={`/documents/${documentId}/risk/findings/${f.id}`}
                className={cn(
                  "group relative flex gap-4 py-4 pr-5 pl-6 transition-colors hover:bg-surface-muted/60",
                  "before:absolute before:top-4 before:bottom-4 before:left-0 before:w-[3px] before:rounded-r-full",
                  SEVERITY_RULE[f.severity],
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <SeverityBadge severity={f.severity} />
                    <span className="eyebrow">{CLAUSE_CATEGORY_LABELS[f.category]}</span>
                  </div>
                  <h3 className="mt-2 text-[0.9375rem] leading-snug font-semibold text-ink group-hover:text-accent">{f.title}</h3>
                  <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-muted">{f.explanation}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
                    <span className="inline-flex items-center gap-1.5">
                      <Quote className="size-3" aria-hidden />
                      {f.evidence.map((e) => formatLocation(e)).join(" · ")}
                    </span>
                    <ConfidenceMeter confidence={f.confidence} />
                    <span>{f.basis === "EXPLICIT" ? "Explicit in text" : "Interpretation"}</span>
                  </div>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-line-strong transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
