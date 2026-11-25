import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-lg border border-line bg-surface shadow-(--shadow-card)", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-ink-subtle">{eyebrow}</div>}
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "critical" | "high" | "medium" | "low" | "info";
const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  critical: "bg-sev-critical-soft text-sev-critical border-transparent",
  high: "bg-sev-high-soft text-sev-high border-transparent",
  medium: "bg-sev-medium-soft text-sev-medium border-transparent",
  low: "bg-sev-low-soft text-sev-low border-transparent",
  info: "bg-sev-info-soft text-sev-info border-transparent",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneClasses[tone], className)}
      {...props}
    />
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-surface-muted p-3 text-ink-subtle">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const alertStyles = {
  info: { cls: "bg-accent-soft text-accent", Icon: Info },
  warning: { cls: "bg-warn-soft text-warn", Icon: AlertTriangle },
  error: { cls: "bg-danger-soft text-danger", Icon: XCircle },
  success: { cls: "bg-ok-soft text-ok", Icon: CheckCircle2 },
};

export function Alert({ kind = "info", title, children, className }: { kind?: keyof typeof alertStyles; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { cls, Icon } = alertStyles[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-md px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn(title ? "mt-0.5" : undefined, "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "danger" | "warn" }) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-subtle">{label}</span>
        {icon && <span className={cn("text-ink-subtle", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>{icon}</span>}
      </div>
      <div className="mt-2 font-serif text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </Card>
  );
}

export const inputClasses =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle shadow-(--shadow-card) focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/20";

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-ink-subtle", className)}>
      AI-assisted review. CasePilot can be wrong and is not a substitute for advice from a qualified lawyer. Verify every conclusion against the source document.
    </p>
  );
}
