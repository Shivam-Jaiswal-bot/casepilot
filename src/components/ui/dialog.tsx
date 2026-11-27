"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal dialog built on the native <dialog> element: the browser provides the
 * focus trap, Escape-to-close, inert background and top-layer stacking.
 * Clicking the dimmed backdrop also closes it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  tone = "default",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-lg open:animate-pop-in",
        className,
      )}
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          {icon && (
            <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5", tone === "danger" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {description}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="-mt-1 -mr-2 rounded-md p-1.5 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
      {footer && <div className="flex flex-wrap justify-end gap-2 rounded-b-xl border-t border-line bg-surface-muted/60 px-6 py-3.5">{footer}</div>}
    </dialog>
  );
}
