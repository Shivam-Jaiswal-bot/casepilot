"use client";

import { CheckCircle2, FileUp, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { Spinner } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

interface UploadItem {
  key: string;
  name: string;
  state: "pending" | "uploading" | "done" | "error";
  message?: string;
  documentId?: string;
}

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Multi-file uploader. Files are uploaded one at a time (each its own request)
 * so a failure in one file is reported individually and never aborts the rest.
 * The server re-validates everything; client checks only give faster feedback.
 */
export function UploadDropzone({ maxMb }: { maxMb: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (key: string, patch: Partial<UploadItem>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const batch = files.map((f) => ({ file: f, key: `${f.name}-${f.size}-${crypto.randomUUID()}` }));
      setItems((prev) => [...batch.map(({ file, key }) => ({ key, name: file.name, state: "pending" as const })), ...prev].slice(0, 20));

      for (const { file, key } of batch) {
        if (!/\.(pdf|docx)$/i.test(file.name)) {
          update(key, { state: "error", message: "Only PDF and .docx files are supported." });
          continue;
        }
        if (file.size > maxMb * 1024 * 1024) {
          update(key, { state: "error", message: `Larger than the ${maxMb} MB limit.` });
          continue;
        }
        update(key, { state: "uploading" });
        try {
          const body = new FormData();
          body.append("file", file);
          const res = await fetch("/api/documents", { method: "POST", body });
          const json = await res.json().catch(() => null);
          if (!res.ok) {
            update(key, { state: "error", message: json?.error?.message ?? `Upload failed (${res.status}).`, documentId: json?.error?.details?.existingDocumentId });
          } else {
            update(key, { state: "done", message: "Uploaded — processing has started.", documentId: json.document.id });
          }
        } catch {
          update(key, { state: "error", message: "Network error during upload." });
        }
      }
      router.refresh();
    },
    [maxMb, router],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void uploadFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload contracts: drop files here or press Enter to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inputRef.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-muted/60",
        )}
      >
        <FileUp className="mb-2 size-6 text-ink-subtle" aria-hidden />
        <p className="text-sm font-medium text-ink">Drop contracts here, or click to browse</p>
        <p className="mt-1 text-xs text-ink-muted">PDF or Word (.docx), up to {maxMb} MB each. Multiple files supported.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void uploadFiles(files);
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface" aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {item.state === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
              ) : item.state === "error" ? (
                <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
              ) : (
                <Spinner className="shrink-0 text-ink-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.name}</span>
              <span className={cn("shrink-0 text-xs", item.state === "error" ? "text-danger" : "text-ink-muted")}>
                {item.state === "pending" ? "Waiting…" : item.state === "uploading" ? "Uploading…" : item.message}
              </span>
              {item.documentId && (
                <Link href={`/documents/${item.documentId}`} className="shrink-0 text-xs font-medium text-accent hover:underline">
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
