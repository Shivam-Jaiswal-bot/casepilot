"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, Field, inputClasses, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { authClient } from "@/lib/auth-client";

/** Only allow same-site relative redirects after sign-in (prevents open redirects). */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim() || email.split("@")[0] })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Authentication failed.");
        return;
      }
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="font-serif text-[1.875rem] leading-tight font-semibold tracking-[-0.015em] text-ink">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-2 text-[0.9375rem] text-ink-muted">
        {mode === "login" ? "Sign in to your contract workspace." : "Start reviewing contracts with evidence-backed answers."}
      </p>
      <Card className="mt-8 p-6 sm:p-7">
        <form onSubmit={onSubmit} className="space-y-5">
          {mode === "signup" && (
            <Field label="Full name">
              <input name="name" autoComplete="name" className={cn(inputClasses, "h-10")} />
            </Field>
          )}
          <Field label="Work email">
            <input name="email" type="email" required autoComplete="email" className={cn(inputClasses, "h-10")} />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 10 characters." : undefined}>
            <input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={cn(inputClasses, "h-10")}
            />
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending && <Spinner />}
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="mt-6 text-center text-sm text-ink-muted">
        {mode === "login" ? (
          <>
            New to CasePilot?{" "}
            <Link href="/signup" className="font-medium text-accent underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
