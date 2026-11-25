import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/app/logo";
import { NavLinks, SidebarNav } from "@/components/app/sidebar-nav";
import { SignOutButton } from "@/components/app/sign-out-button";
import { Skeleton } from "@/components/ui/primitives";
import { requirePageUser } from "@/server/auth/session";

async function UserPanel() {
  const user = await requirePageUser();
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>
        {user.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{user.name}</div>
        <div className="truncate text-xs text-ink-subtle">{user.email}</div>
      </div>
      <SignOutButton />
    </div>
  );
}

/**
 * Application shell. The chrome is static (prerendered); the signed-in user
 * streams in behind a Suspense boundary, per the Cache Components model.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="flex flex-col gap-4 border-b border-line bg-canvas px-4 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:gap-6 lg:border-r lg:border-b-0 lg:px-4 lg:py-5">
        <div className="flex items-center justify-between lg:block">
          <Link href="/dashboard" className="rounded-md lg:px-2">
            <Logo />
          </Link>
          <div className="lg:hidden">
            <SignOutButton />
          </div>
        </div>
        <Suspense fallback={<NavLinks activePath={null} />}>
          <SidebarNav />
        </Suspense>
        <div className="hidden border-t border-line pt-4 lg:mt-auto lg:block">
          <Suspense fallback={<Skeleton className="h-9 w-full" />}>
            <UserPanel />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
