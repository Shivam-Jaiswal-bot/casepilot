import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ---------------------------------------------------------------- Surfaces */

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-line bg-surface shadow-sm", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-ink-muted ring-1 ring-line [&_svg]:size-3.5">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.005em] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** A row of metadata rendered under the title (status, file details…). */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 pb-7 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="font-serif text-[1.75rem] leading-[1.15] font-semibold tracking-[-0.015em] text-ink text-balance sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-muted text-pretty">{description}</p>}
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Horizontal list of metadata items separated by hairline dots. */
export function MetaList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem] text-ink-muted", className)}>
      {items.filter(Boolean).map((item, i) => (
        <li key={i} className="inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-ink-subtle">
          {i > 0 && <span className="mr-1.5 size-0.5 rounded-full bg-line-strong" aria-hidden />}
          {item}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Badges */

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "critical" | "high" | "medium" | "low" | "info";
const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted ring-line",
  accent: "bg-accent-soft text-accent ring-accent-muted/60",
  ok: "bg-ok-soft text-ok ring-ok/15",
  warn: "bg-warn-soft text-warn ring-warn/15",
  danger: "bg-danger-soft text-danger ring-danger/15",
  critical: "bg-sev-critical-soft text-sev-critical ring-sev-critical/15",
  high: "bg-sev-high-soft text-sev-high ring-sev-high/15",
  medium: "bg-sev-medium-soft text-sev-medium ring-sev-medium/15",
  low: "bg-sev-low-soft text-sev-low ring-sev-low/15",
  info: "bg-sev-info-soft text-sev-info ring-sev-info/15",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.375rem] items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- Feedback */

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80", className)}
    />
  );
}

/** Shimmering placeholder block for loading states. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--surface-muted)_0%,var(--surface-sunken)_50%,var(--surface-muted)_100%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-6 py-10" : "px-6 py-16", className)}>
      {icon && (
        <div className="relative mb-4">
          <div className="absolute -inset-2 rounded-2xl bg-surface-muted/70" aria-hidden />
          <div className="relative flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-sm [&_svg]:size-5">{icon}</div>
        </div>
      )}
      <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-ink-muted text-pretty">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

const alertStyles = {
  info: { cls: "border-accent-muted/70 bg-accent-soft/70 text-accent", Icon: Info },
  warning: { cls: "border-warn/20 bg-warn-soft text-warn", Icon: TriangleAlert },
  error: { cls: "border-danger/20 bg-danger-soft text-danger", Icon: XCircle },
  success: { cls: "border-ok/20 bg-ok-soft text-ok", Icon: CheckCircle2 },
};

export function Alert({
  kind = "info",
  title,
  children,
  action,
  className,
}: {
  kind?: keyof typeof alertStyles;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = alertStyles[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-[0.8125rem]", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title ? "mt-0.5" : undefined, "leading-relaxed text-ink-muted")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Metrics */

type MetricTone = "neutral" | "ok" | "warn" | "danger";
const metricTone: Record<MetricTone, { chip: string; dot: string }> = {
  neutral: { chip: "bg-accent-soft text-accent ring-accent-muted/50", dot: "bg-ink-subtle/50" },
  ok: { chip: "bg-ok-soft text-ok ring-ok/15", dot: "bg-ok" },
  warn: { chip: "bg-warn-soft text-warn ring-warn/15", dot: "bg-warn" },
  danger: { chip: "bg-danger-soft text-danger ring-danger/15", dot: "bg-danger" },
};

/**
 * Key figure with label, icon and a one-line status. `status` describes the
 * figure in words; the dot echoes its tone (and pulses while work is running).
 */
export function MetricCard({
  label,
  value,
  status,
  icon,
  tone = "neutral",
  live = false,
  footer,
}: {
  label: string;
  value: ReactNode;
  status?: ReactNode;
  icon: ReactNode;
  tone?: MetricTone;
  live?: boolean;
  footer?: ReactNode;
}) {
  const t = metricTone[tone];
  return (
    <Card className="group relative overflow-hidden p-5 transition-[box-shadow,border-color] duration-200 hover:border-line-strong hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[0.8125rem] font-medium text-ink-muted">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg ring-1 ring-inset [&_svg]:size-4", t.chip)} aria-hidden>
          {icon}
        </span>
      </div>
      <div className="num mt-3 font-serif text-[2.25rem] leading-none font-semibold tracking-tight text-ink">{value}</div>
      {status && (
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
          <span className="relative flex size-1.5">
            {live && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", t.dot)} />}
            <span className={cn("relative inline-flex size-1.5 rounded-full", t.dot)} />
          </span>
          <span className="truncate">{status}</span>
        </div>
      )}
      {footer}
    </Card>
  );
}

/* ------------------------------------------------------------------ Inputs */

export const inputClasses =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-ink-subtle/50 focus:border-focus focus:outline-none focus:ring-[3px] focus:ring-focus/15 disabled:opacity-50";

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[0.8125rem] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-subtle">{hint}</span>}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[0.625rem] font-medium text-ink-subtle shadow-xs">
      {children}
    </kbd>
  );
}

/* ----------------------------------------------------------------- Content */

/** Label that marks AI-generated content, so it is never confused with contract text. */
export function AiLabel({ className, children = "AI assessment" }: { className?: string; children?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-accent uppercase", className)}>
      <span className="size-1 rounded-full bg-brass" aria-hidden />
      {children}
    </span>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-ink-subtle", className)}>
      AI-assisted review. CasePilot can be wrong and is not a substitute for advice from a qualified lawyer. Verify every conclusion against the source document.
    </p>
  );
}
