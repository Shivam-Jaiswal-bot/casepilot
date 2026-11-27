import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon-sm" | "icon";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-accent-hover hover:shadow-md",
  secondary:
    "border border-line-strong bg-surface text-ink shadow-xs hover:border-ink-subtle/60 hover:bg-surface-muted",
  ghost: "text-ink-muted hover:bg-surface-sunken/70 hover:text-ink",
  danger: "border border-line-strong bg-surface text-danger shadow-xs hover:border-danger/40 hover:bg-danger-soft",
  "danger-solid": "bg-danger text-white shadow-sm hover:bg-[#8d1f24]",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
  sm: "h-8 px-3 text-[0.8125rem] [&_svg]:size-3.5",
  md: "h-9 px-4 text-sm [&_svg]:size-4",
  lg: "h-10 px-5 text-sm [&_svg]:size-4",
  "icon-sm": "size-8 [&_svg]:size-4",
  icon: "size-9 [&_svg]:size-4",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
