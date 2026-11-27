import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/app/logo";
import { NavLinks, SidebarNav } from "@/components/app/sidebar-nav";
import { SignOutButton } from "@/components/app/sign-out-button";
import { requirePageUser } from "@/server/auth/session";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

async function UserPanel() {
  const user = await requirePageUser();
  return (
    <div className="flex items-center gap-3 rounded-lg p-2">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2b4372] to-accent text-xs font-semibold tracking-wide text-white ring-1 ring-white/15"
        aria-hidden
      >
        {initials(user.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-chrome-ink">{user.name}</div>
        <div className="truncate text-xs text-chrome-muted">{user.email}</div>
      </div>
      <SignOutButton />
    </div>
  );
}

function UserPanelFallback() {
  return (
    <div className="flex items-center gap-3 p-2" aria-hidden>
      <div className="size-9 rounded-full bg-chrome-raised" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-24 rounded bg-chrome-raised" />
        <div className="h-2.5 w-32 rounded bg-chrome-raised/70" />
      </div>
    </div>
  );
}

/**
 * Application shell: a midnight sidebar (top bar on small screens) around a
 * warm canvas. The chrome is static (prerendered); the signed-in user streams
 * in behind a Suspense boundary, per the Cache Components model.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium text-ink shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 z-40 flex flex-col gap-3 border-b border-chrome-line bg-chrome px-4 py-3 text-chrome-ink lg:h-dvh lg:w-64 lg:shrink-0 lg:gap-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <div className="flex items-center justify-between lg:px-2 lg:pb-7">
          <Link href="/dashboard" className="rounded-lg" aria-label="CasePilot dashboard">
            <Logo tone="light" />
          </Link>
          <div className="lg:hidden">
            <SignOutButton />
          </div>
        </div>
        <div className="hidden px-3 pb-2 lg:block">
          <span className="text-[0.6875rem] font-semibold tracking-[0.1em] text-chrome-muted/80 uppercase">Workspace</span>
        </div>
        <Suspense fallback={<NavLinks activePath={null} />}>
          <SidebarNav />
        </Suspense>
        <div className="hidden lg:mt-auto lg:block">
          <div className="mx-2 mb-3 rounded-lg border border-chrome-line bg-chrome-raised/40 px-3 py-2.5">
            <p className="text-[0.6875rem] leading-relaxed text-chrome-muted">
              Private to your account. AI-assisted analysis, not legal advice.
            </p>
          </div>
          <div className="border-t border-chrome-line pt-3">
            <Suspense fallback={<UserPanelFallback />}>
              <UserPanel />
            </Suspense>
          </div>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        {children}
      </main>
    </div>
  );
}
