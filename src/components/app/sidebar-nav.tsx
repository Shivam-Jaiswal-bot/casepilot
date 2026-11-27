"use client";

import { FileText, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
] as const;

/** Pathname-aware nav. `usePathname()` is runtime data, so this renders inside <Suspense>. */
export function SidebarNav() {
  return <NavLinks activePath={usePathname()} />;
}

/** Static rendering used as the Suspense fallback (no active highlight). */
export function NavLinks({ activePath }: { activePath: string | null }) {
  return (
    <nav aria-label="Main" className="flex gap-1 lg:flex-col">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = activePath !== null && (activePath === href || activePath.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
              active ? "bg-chrome-raised text-chrome-ink" : "text-chrome-muted hover:bg-chrome-raised/60 hover:text-chrome-ink",
            )}
          >
            {/* active marker: a brass rule on the inner edge (desktop) */}
            <span
              aria-hidden
              className={cn("absolute top-2 bottom-2 left-0 hidden w-[3px] rounded-r-full bg-brass transition-opacity lg:block", active ? "opacity-100" : "opacity-0")}
            />
            <Icon className={cn("size-4 transition-colors", active ? "text-chrome-ink" : "text-chrome-muted group-hover:text-chrome-ink")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
