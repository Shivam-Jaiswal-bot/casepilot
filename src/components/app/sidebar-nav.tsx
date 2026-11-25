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
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-surface text-ink shadow-(--shadow-card) ring-1 ring-line" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
