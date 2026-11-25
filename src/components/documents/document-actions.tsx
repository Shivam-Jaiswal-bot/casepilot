"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";

async function readError(res: Response): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? `Request failed (${res.status}).`;
}

export function RetryButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await fetch(`/api/documents/${documentId}/retry`, { method: "POST" });
          if (!res.ok) setError(await readError(res));
          setPending(false);
          router.refresh();
        }}
      >
        {pending ? <Spinner /> : <RotateCcw className="size-3.5" aria-hidden />}
        Retry
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/**
 * Two-step inline delete confirmation (no browser `confirm()` dialog).
 * Deletion removes the file, chunks, embeddings, conversations and analyses.
 */
export function DeleteButton({ documentId, title, redirectTo }: { documentId: string; title: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete ${title}`}>
        <Trash2 className="size-3.5" aria-hidden />
        <span className="sr-only sm:not-sr-only">Delete</span>
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">Delete permanently, including all indexed data?</span>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
          if (!res.ok) {
            setError(await readError(res));
            setPending(false);
            return;
          }
          if (redirectTo) router.replace(redirectTo);
          router.refresh();
        }}
      >
        {pending && <Spinner />}
        Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
