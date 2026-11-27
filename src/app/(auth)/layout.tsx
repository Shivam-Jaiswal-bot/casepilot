import { BookOpenText, Quote, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/app/logo";

const POINTS = [
  { icon: BookOpenText, title: "Answers grounded in your contract", body: "Every answer cites the page and section it was drawn from." },
  { icon: ShieldCheck, title: "Clause-by-clause risk review", body: "Fifteen clause categories reviewed against the contract text." },
  { icon: Quote, title: "Evidence you can verify", body: "Findings are kept only when their quotation is located in the document." },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-chrome px-12 py-12 text-chrome-ink lg:flex lg:flex-col">
        {/* faint ruled-paper texture */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(0deg,transparent_0,transparent_31px,#ffffff_31px,#ffffff_32px)]"
        />
        <div className="relative">
          <Logo tone="light" />
        </div>
        <div className="relative my-auto max-w-md py-12">
          <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-brass uppercase">Legal document intelligence</p>
          <h2 className="mt-4 font-serif text-[2.4rem] leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
            Read every contract like your best reviewer would.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-chrome-line bg-chrome-raised text-chrome-ink">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium text-chrome-ink">{title}</p>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-chrome-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-chrome-muted">CasePilot provides AI-assisted analysis, not legal advice.</p>
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <Logo className="mb-10 lg:hidden" />
        <div className="w-full max-w-[25rem] animate-rise-in">{children}</div>
        <p className="mt-10 max-w-sm text-center text-xs leading-relaxed text-ink-subtle">
          Contracts are processed privately within your account. CasePilot provides AI-assisted analysis, not legal advice.
        </p>
      </div>
    </div>
  );
}
