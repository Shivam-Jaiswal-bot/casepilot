"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, inputClasses, Spinner } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

export function StartAnalysisForm({ documentId, label = "Run risk analysis", compact = false }: { documentId: string; label?: string; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [perspective, setPerspective] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/analyses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ perspective: perspective.trim() || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? `Could not start the analysis (${res.status}).`);
        return;
      }
      toast({ kind: "success", title: "Risk analysis started", description: "Each clause category is being reviewed. This page updates automatically." });
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={compact ? "flex flex-wrap items-center gap-2" : "space-y-4"}>
      <label className={compact ? "min-w-48 flex-1" : "block"}>
        <span className={compact ? "sr-only" : "mb-1.5 block text-[0.8125rem] font-medium text-ink"}>Review from the perspective of (optional)</span>
        <input
          value={perspective}
          onChange={(e) => setPerspective(e.target.value)}
          maxLength={200}
          placeholder="e.g. We are the Customer (Northwind Retail Inc.)"
          className={cn(inputClasses, !compact && "h-10")}
        />
      </label>
      <Button type="submit" disabled={pending} variant={compact ? "secondary" : "primary"} size={compact ? "md" : "lg"}>
        {pending ? <Spinner /> : <Play aria-hidden />}
        {label}
      </Button>
      {error && <Alert kind="error" className="w-full">{error}</Alert>}
    </form>
  );
}
