import type { DocumentStatus, RiskSeverity } from "@/lib/domain";
import { Badge, Spinner } from "./primitives";

const STATUS_META: Record<DocumentStatus, { label: string; tone: "neutral" | "accent" | "ok" | "danger"; busy: boolean }> = {
  UPLOADED: { label: "Queued", tone: "neutral", busy: true },
  PROCESSING: { label: "Extracting", tone: "accent", busy: true },
  INDEXING: { label: "Indexing", tone: "accent", busy: true },
  COMPLETED: { label: "Ready", tone: "ok", busy: false },
  FAILED: { label: "Failed", tone: "danger", busy: false },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone}>
      {meta.busy && <Spinner className="size-2.5 border-[1.5px]" label={meta.label} />}
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
export const SEVERITY_DOT: Record<RiskSeverity, string> = {
  CRITICAL: "bg-sev-critical",
  HIGH: "bg-sev-high",
  MEDIUM: "bg-sev-medium",
  LOW: "bg-sev-low",
  INFORMATIONAL: "bg-sev-info",
};

export function SeverityBadge({ severity }: { severity: RiskSeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]}>
      <span className={`size-1.5 rounded-full ${SEVERITY_DOT[severity]}`} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}
