import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Lightweight CSS tooltip shown on hover and keyboard focus (no JS).
 * Purely visual: the wrapped control must carry its own accessible name
 * (aria-label), so the tooltip is hidden from assistive technology.
 */
export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom"; className?: string }) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {children}
      <span
        aria-hidden
        className={cn(
          // display:none while hidden, so an invisible tooltip never widens a scroll container.
          "pointer-events-none absolute left-1/2 z-50 hidden -translate-x-1/2 rounded-md bg-chrome px-2 py-1 text-[0.6875rem] font-medium whitespace-nowrap text-chrome-ink shadow-md",
          "animate-fade-in [animation-delay:350ms] group-hover/tooltip:block group-has-[:focus-visible]/tooltip:block group-has-[:focus-visible]/tooltip:[animation-delay:0ms]",
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
        )}
      >
        {content}
      </span>
    </span>
  );
}
