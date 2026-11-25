"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink disabled:opacity-50"
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut className="size-4" aria-hidden />
    </button>
  );
}
