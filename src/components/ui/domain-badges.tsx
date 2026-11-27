import { RISK_SEVERITIES, type DocumentStatus, type RiskSeverity, type SeverityCounts } from "@/lib/domain";
import { cn } from "@/lib/cn";
import { Badge, Spinner } from "./primitives";

const STATUS_META: Record<DocumentStatus, { label: string; tone: "neutral" | "accent" | "ok" | "danger"; busy: boolean }> = {
  UPLOADED: { label: "Queued", tone: "neutral", busy: true },
  PROCESSING: { label: "Extracting", tone: "accent", busy: true },
  INDEXING: { label: "Indexing", tone: "accent", busy: true },
  COMPLETED: { label: "Ready", tone: "ok", busy: false },
  FAILED: { label: "Failed", tone: "danger", busy: false },
};

export function DocumentStatusBadge({ status, className }: { status: DocumentStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.busy ? (
        <Spinner className="size-2.5 border-[1.5px]" label={meta.label} />
      ) : (
        <span className={cn("size-1.5 rounded-full", status === "COMPLETED" ? "bg-ok" : "bg-danger")} aria-hidden />
      )}
      {meta.label}
    </Badge>
  );
}

const SEVERITY_TONE = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", INFORMATIONAL: "info" } as const;

export const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Informational",
};

/** Short labels for tight layouts (legends, tiles). */
export const SEVERITY_SHORT: Record<RiskSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Info",
};

export const SEVERITY_DOT: Record<RiskSeverity, string> = {
  CRITICAL: "bg-sev-critical",
  HIGH: "bg-sev-high",
  MEDIUM: "bg-sev-medium",
  LOW: "bg-sev-low",
  INFORMATIONAL: "bg-sev-info",
};

export const SEVERITY_TEXT: Record<RiskSeverity, string> = {
  CRITICAL: "text-sev-critical",
  HIGH: "text-sev-high",
  MEDIUM: "text-sev-medium",
  LOW: "text-sev-low",
  INFORMATIONAL: "text-sev-info",
};

/** Left accent used on finding rows so severity reads before the text does. */
export const SEVERITY_RULE: Record<RiskSeverity, string> = {
  CRITICAL: "before:bg-sev-critical",
  HIGH: "before:bg-sev-high",
  MEDIUM: "before:bg-sev-medium",
  LOW: "before:bg-sev-low",
  INFORMATIONAL: "before:bg-sev-info/60",
};

export function SeverityBadge({ severity, className }: { severity: RiskSeverity; className?: string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} className={className}>
      <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[severity])} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

/**
 * Stacked distribution of findings by severity (proportional widths).
 * Renders an empty track when there are no findings.
 */
export function SeverityBar({ counts, className, size = "md" }: { counts: SeverityCounts; className?: string; size?: "sm" | "md" }) {
  const total = RISK_SEVERITIES.reduce((n, s) => n + counts[s], 0);
  const summary = total
    ? RISK_SEVERITIES.filter((s) => counts[s] > 0)
        .map((s) => `${counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`)
        .join(", ")
    : "No findings";
  return (
    <div
      role="img"
      aria-label={`Severity distribution: ${summary}`}
      className={cn("flex w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken", size === "sm" ? "h-1.5" : "h-2", className)}
    >
      {total > 0 &&
        RISK_SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className={cn("h-full first:rounded-l-full last:rounded-r-full", SEVERITY_DOT[s])} style={{ width: `${(counts[s] / total) * 100}%` }} />
        ))}
    </div>
  );
}

/** Inline legend: dot + count per severity present. */
export function SeverityLegend({ counts, className, showZero = false }: { counts: SeverityCounts; className?: string; showZero?: boolean }) {
  const shown = RISK_SEVERITIES.filter((s) => showZero || counts[s] > 0);
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-ink-muted", className)}>
      {shown.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[s])} aria-hidden />
          <span className="num font-semibold text-ink">{counts[s]}</span>
          {SEVERITY_SHORT[s]}
        </li>
      ))}
    </ul>
  );
}
