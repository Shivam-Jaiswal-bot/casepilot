import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/app/auth-form";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
