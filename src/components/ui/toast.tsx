"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error" | "info";
interface ToastInput {
  kind?: ToastKind;
  title: string;
  description?: string;
}
interface ToastItem extends Required<Pick<ToastInput, "kind" | "title">> {
  id: number;
  description?: string;
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

/** Fire-and-forget notifications: `const toast = useToast(); toast({ title: "Saved" })`. */
export const useToast = () => useContext(ToastContext);

const ICON = {
  success: <CheckCircle2 className="size-4 text-ok" aria-hidden />,
  error: <XCircle className="size-4 text-danger" aria-hidden />,
  info: <Info className="size-4 text-accent" aria-hidden />,
};

/**
 * Minimal toast system (no dependency). Toasts stack bottom-right, auto-dismiss
 * (errors stay longer) and are announced through a polite live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    ({ kind = "info", title, description }: ToastInput) => {
      const id = ++nextId.current;
      setToasts((prev) => [...prev.slice(-3), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex animate-rise-in items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-lg",
              t.kind === "error" ? "border-danger/25" : "border-line",
            )}
          >
            <span className="mt-0.5">{ICON[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-muted">{t.description}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="-m-1 rounded p-1 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink" aria-label="Dismiss notification">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
