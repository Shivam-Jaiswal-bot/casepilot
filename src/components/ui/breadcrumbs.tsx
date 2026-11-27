import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb trail; the last crumb is the current page. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-4 min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-ink-subtle">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-line-strong" aria-hidden />}
              <li className={cn("min-w-0", last ? "truncate font-medium text-ink-muted" : "shrink-0")} aria-current={last ? "page" : undefined}>
                {c.href && !last ? (
                  <Link href={c.href} className="rounded transition-colors hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  c.label
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
