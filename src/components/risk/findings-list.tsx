"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SeverityBadge, SEVERITY_LABEL } from "@/components/ui/domain-badges";
import { Badge, EmptyState } from "@/components/ui/primitives";
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

export function FindingsList({ documentId, findings }: { documentId: string; findings: FindingListItem[] }) {
  const [severity, setSeverity] = useState<RiskSeverity | "ALL">("ALL");
  const [category, setCategory] = useState<ClauseCategory | "ALL">("ALL");
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))], [findings]);
  const visible = findings.filter((f) => (severity === "ALL" || f.severity === severity) && (category === "ALL" || f.category === category));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by severity">
          {(["ALL", ...RISK_SEVERITIES] as const).map((s) => {
            const count = s === "ALL" ? findings.length : findings.filter((f) => f.severity === s).length;
            if (s !== "ALL" && count === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                aria-pressed={severity === s}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  severity === s ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {s === "ALL" ? "All" : SEVERITY_LABEL[s]} · {count}
              </button>
            );
          })}
        </div>
        <select
          aria-label="Filter by clause category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ClauseCategory | "ALL")}
          className="ml-auto h-8 rounded-md border border-line-strong bg-surface px-2 text-xs text-ink"
        >
          <option value="ALL">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CLAUSE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No findings match these filters" />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((f) => (
            <li key={f.id}>
              <Link href={`/documents/${documentId}/risk/findings/${f.id}`} className="group flex gap-4 px-5 py-4 hover:bg-surface-muted/50">
                <div className="w-28 shrink-0 pt-0.5">
                  <SeverityBadge severity={f.severity} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-ink-subtle">{CLAUSE_CATEGORY_LABELS[f.category]}</span>
                    {f.basis === "INTERPRETATION" && <Badge tone="neutral">Interpretation</Badge>}
                    <span className="text-xs text-ink-subtle">Confidence: {f.confidence.toLowerCase()}</span>
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-ink group-hover:text-accent">{f.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{f.explanation}</p>
                  <p className="mt-2 text-xs text-ink-subtle">
                    Evidence: {f.evidence.map((e) => formatLocation(e)).join(" · ")}
                  </p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-ink-subtle group-hover:text-accent" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
