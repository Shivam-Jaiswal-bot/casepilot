"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  key: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  selected?: boolean;
  onSelect: () => void;
}

/**
 * Accessible dropdown menu: a button that opens a list of actions.
 * Keyboard: Enter/Space/ArrowDown open; arrows move; Home/End jump;
 * Escape closes and returns focus; clicking outside closes.
 */
export function Dropdown({
  trigger,
  label,
  items,
  header,
  align = "end",
  triggerClassName,
  menuClassName,
}: {
  trigger: ReactNode;
  /** Accessible name for the trigger button. */
  label: string;
  items: MenuItem[];
  header?: ReactNode;
  align?: "start" | "end";
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const openMenu = () => {
    setOpen(true);
    // Focus the selected item (or the first) once the menu has rendered.
    const start = Math.max(0, items.findIndex((i) => i.selected));
    requestAnimationFrame(() => itemRefs.current[start]?.focus());
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const move = (i: number) => itemRefs.current[(i + items.length) % items.length]?.focus();
    const actions: Record<string, () => void> = {
      ArrowDown: () => move(current + 1),
      ArrowUp: () => move(current - 1),
      Home: () => move(0),
      End: () => move(items.length - 1),
      Escape: () => close(),
    };
    if (e.key === "Tab") return setOpen(false);
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 w-72 origin-top animate-pop-in overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg",
            align === "end" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          {header && <div className="eyebrow px-3 pt-2 pb-1.5">{header}</div>}
          <div className="scroll-thin max-h-72 overflow-y-auto">
            {items.map((item, i) => (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted",
                  item.selected ? "text-ink" : "text-ink-muted",
                )}
              >
                {item.icon && <span className="mt-0.5 text-ink-subtle [&_svg]:size-3.5">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate", item.selected && "font-medium")}>{item.label}</span>
                  {item.description && <span className="block truncate text-xs text-ink-subtle">{item.description}</span>}
                </span>
                {item.selected && <Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
