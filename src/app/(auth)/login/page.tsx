import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/app/auth-form";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    // useSearchParams() in the form needs a Suspense boundary under Cache Components.
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
