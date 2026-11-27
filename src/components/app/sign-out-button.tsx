"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";

export function SignOutButton({ className }: { className?: string }) {
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
      className={cn(
        "rounded-md p-1.5 text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-ink disabled:opacity-50",
        className,
      )}
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut className="size-4" aria-hidden />
    </button>
  );
}
