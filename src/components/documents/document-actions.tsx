"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonSize } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, Spinner } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

async function readError(res: Response): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? `Request failed (${res.status}).`;
}

export function RetryButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const res = await fetch(`/api/documents/${documentId}/retry`, { method: "POST" });
          if (res.ok) toast({ kind: "success", title: "Processing restarted", description: "The document has been queued again." });
          else toast({ kind: "error", title: "Could not retry", description: await readError(res) });
        } catch {
          toast({ kind: "error", title: "Could not retry", description: "Network error. Please try again." });
        } finally {
          setPending(false);
          router.refresh();
        }
      }}
    >
      {pending ? <Spinner /> : <RotateCcw aria-hidden />}
      Retry
    </Button>
  );
}

/**
 * Delete with a confirmation dialog. Deletion removes the file, chunks,
 * embeddings, conversations and analyses, so the dialog says so plainly.
 */
export function DeleteButton({
  documentId,
  title,
  redirectTo,
  size = "sm",
  showLabel = true,
}: {
  documentId: string;
  title: string;
  redirectTo?: string;
  size?: ButtonSize;
  showLabel?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setOpen(false);
      toast({ kind: "success", title: "Document deleted", description: `“${title}” and its indexed data were removed.` });
      if (redirectTo) router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size={showLabel ? size : "icon-sm"} onClick={() => setOpen(true)} aria-label={`Delete ${title}`} title="Delete document">
        <Trash2 aria-hidden />
        {showLabel && <span className="sr-only sm:not-sr-only">Delete</span>}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        icon={<Trash2 />}
        tone="danger"
        title="Delete this document?"
        description={
          <>
            <span className="font-medium text-ink">{title}</span> will be permanently deleted, together with its search index, conversations and risk analyses. This cannot be undone.
          </>
        }
        footer={
          <>
            {/* The safe choice gets initial focus. */}
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending} autoFocus>
              Cancel
            </Button>
            <Button variant="danger-solid" onClick={confirm} disabled={pending}>
              {pending && <Spinner />}
              Delete permanently
            </Button>
          </>
        }
      >
        {error && <Alert kind="error">{error}</Alert>}
      </Dialog>
    </>
  );
}
