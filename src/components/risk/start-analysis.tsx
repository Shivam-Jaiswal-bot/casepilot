"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, inputClasses, Spinner } from "@/components/ui/primitives";

export function StartAnalysisForm({ documentId, label = "Run risk analysis", compact = false }: { documentId: string; label?: string; compact?: boolean }) {
  const router = useRouter();
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
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={compact ? "flex flex-wrap items-center gap-2" : "space-y-3"}>
      <label className={compact ? "min-w-56 flex-1" : "block"}>
        <span className={compact ? "sr-only" : "mb-1.5 block text-sm font-medium text-ink"}>Review from the perspective of (optional)</span>
        <input
          value={perspective}
          onChange={(e) => setPerspective(e.target.value)}
          maxLength={200}
          placeholder="e.g. We are the Customer (Northwind Retail Inc.)"
          className={inputClasses}
        />
      </label>
      <Button type="submit" disabled={pending} variant={compact ? "secondary" : "primary"}>
        {pending ? <Spinner /> : <Play className="size-3.5" aria-hidden />}
        {label}
      </Button>
      {error && <Alert kind="error">{error}</Alert>}
    </form>
  );
}
