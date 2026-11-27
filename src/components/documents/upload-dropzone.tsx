"use client";

import { CheckCircle2, CloudUpload, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { Spinner } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
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
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (key: string, patch: Partial<UploadItem>) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const batch = files.map((f) => ({ file: f, key: `${f.name}-${f.size}-${crypto.randomUUID()}` }));
      setItems((prev) => [...batch.map(({ file, key }) => ({ key, name: file.name, state: "pending" as const })), ...prev].slice(0, 20));
      let ok = 0;
      let failed = 0;

      for (const { file, key } of batch) {
        if (!/\.(pdf|docx)$/i.test(file.name)) {
          update(key, { state: "error", message: "Only PDF and .docx files are supported." });
          failed++;
          continue;
        }
        if (file.size > maxMb * 1024 * 1024) {
          update(key, { state: "error", message: `Larger than the ${maxMb} MB limit.` });
          failed++;
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
            failed++;
          } else {
            update(key, { state: "done", message: "Uploaded — processing has started.", documentId: json.document.id });
            ok++;
          }
        } catch {
          update(key, { state: "error", message: "Network error during upload." });
          failed++;
        }
      }
      if (ok) toast({ kind: "success", title: `${ok} contract${ok === 1 ? "" : "s"} uploaded`, description: "Processing runs in the background; the library updates automatically." });
      if (failed) toast({ kind: "error", title: `${failed} file${failed === 1 ? "" : "s"} could not be uploaded`, description: "See the upload list for details." });
      router.refresh();
    },
    [maxMb, router, toast],
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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed px-6 py-10 text-center transition-[border-color,background-color,box-shadow] duration-200",
          dragging ? "border-accent bg-accent-soft shadow-md" : "border-line-strong bg-surface hover:border-accent-muted hover:bg-accent-soft/30",
        )}
      >
        <div
          className={cn(
            "mb-4 flex size-12 items-center justify-center rounded-xl border bg-surface shadow-sm transition-[transform,border-color] duration-200",
            dragging ? "-translate-y-0.5 border-accent-muted" : "border-line group-hover:-translate-y-0.5",
          )}
        >
          <CloudUpload className={cn("size-5", dragging ? "text-accent" : "text-ink-muted")} aria-hidden />
        </div>
        <p className="text-[0.9375rem] font-medium text-ink">
          {dragging ? "Release to upload" : (
            <>
              Drop contracts here, or <span className="text-accent underline-offset-4 group-hover:underline">browse files</span>
            </>
          )}
        </p>
        <p className="mt-1.5 text-xs text-ink-muted">PDF or Word (.docx) · up to {maxMb} MB each · multiple files supported</p>
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
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-xs" aria-live="polite" aria-label="Uploads">
          {items.map((item) => (
            <li key={item.key} className="flex animate-fade-in items-center gap-3 px-4 py-3 text-sm">
              {item.state === "done" ? (
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
              ) : item.state === "error" ? (
                <XCircle className="size-4 shrink-0 text-danger" aria-hidden />
              ) : (
                <Spinner className="shrink-0 text-accent" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{item.name}</span>
              <span className={cn("hidden shrink-0 text-xs sm:inline", item.state === "error" ? "text-danger" : "text-ink-muted")}>
                {item.state === "pending" ? "Waiting…" : item.state === "uploading" ? "Uploading…" : item.message}
              </span>
              {item.documentId && (
                <Link href={`/documents/${item.documentId}`} className="shrink-0 text-xs font-medium text-accent underline-offset-4 hover:underline">
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
