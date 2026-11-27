"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { inputClasses, Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "COMPLETED", label: "Ready" },
  { value: "ACTIVE", label: "Processing" },
  { value: "FAILED", label: "Failed" },
];

/** Search + status filter, kept in the URL so results are shareable and server-filtered. */
export function LibraryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();

  const apply = (next: { q?: string; status?: string }) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    startTransition(() => router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`));
  };

  // Debounce typing so each keystroke doesn't trigger a server render.
  useEffect(() => {
    if (query === (params.get("q") ?? "")) return;
    const t = setTimeout(() => apply({ q: query.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Search documents</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or filename" className={cn(inputClasses, "h-9 pl-9")} />
      </label>
      <label className="flex items-center gap-2">
        <span className="sr-only">Filter by status</span>
        <select value={params.get("status") ?? ""} onChange={(e) => apply({ status: e.target.value })} className={cn(inputClasses, "w-full sm:w-44")}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {pending && <Spinner className="text-ink-subtle" />}
      </label>
    </div>
  );
}
