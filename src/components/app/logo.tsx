import { cn } from "@/lib/cn";

/**
 * CasePilot mark: a document whose folded corner doubles as a navigation
 * chevron, on a midnight tile with a brass rule. `tone="light"` is for the
 * dark sidebar.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" className="fill-accent" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="none" stroke="white" strokeOpacity="0.12" />
      <path d="M10.5 8.5h7.25l4.25 4.25V23.5h-11.5z" fill="none" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M17.5 8.75V13h4.25" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M13.5 17.25h5M13.5 20h3.25" stroke="white" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 26.5h16" className="stroke-brass" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={tone === "light" ? "ring-1 ring-white/10 rounded-lg" : undefined} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-serif text-[1.15rem] font-semibold tracking-[-0.01em]", tone === "light" ? "text-chrome-ink" : "text-ink")}>CasePilot</span>
        <span className={cn("mt-1 text-[0.625rem] font-medium tracking-[0.14em] uppercase", tone === "light" ? "text-chrome-muted" : "text-ink-subtle")}>
          Contract intelligence
        </span>
      </span>
    </span>
  );
}
