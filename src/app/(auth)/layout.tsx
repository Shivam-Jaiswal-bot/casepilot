import { Logo } from "@/components/app/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-10 max-w-sm text-center text-xs text-ink-subtle">
        Contracts are processed privately within your account. CasePilot provides AI-assisted analysis, not legal advice.
      </p>
    </div>
  );
}
