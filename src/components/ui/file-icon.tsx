import type { FileType } from "@/lib/domain";
import { cn } from "@/lib/cn";

const STYLE: Record<FileType, { label: string; tab: string }> = {
  pdf: { label: "PDF", tab: "bg-[#b3343c]" },
  docx: { label: "DOC", tab: "bg-[#2d5aa0]" },
};

/** Document glyph with a coloured format tab. Purely presentational. */
export function FileIcon({ type, size = "md", className }: { type: FileType; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = STYLE[type];
  const dims = size === "sm" ? "h-8 w-[1.625rem]" : size === "lg" ? "h-12 w-10" : "h-10 w-8";
  return (
    <span aria-hidden className={cn("relative inline-flex shrink-0 flex-col justify-end rounded-[5px] border border-line-strong bg-surface shadow-xs", dims, className)}>
      {/* folded corner */}
      <span className="absolute top-0 right-0 size-2 rounded-bl-[3px] border-b border-l border-line-strong bg-surface-muted" />
      <span className="mx-[3px] mb-auto mt-[38%] space-y-[2px]">
        <span className="block h-px w-3/4 bg-line-strong" />
        <span className="block h-px w-1/2 bg-line-strong" />
      </span>
      <span className={cn("mx-[2px] mb-[2px] rounded-[2px] py-px text-center font-sans text-[0.5rem] leading-[0.7rem] font-bold tracking-wide text-white", s.tab)}>{s.label}</span>
    </span>
  );
}
