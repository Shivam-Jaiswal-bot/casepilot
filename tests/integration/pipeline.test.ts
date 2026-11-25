import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_COLUMN_DIMENSIONS } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { documentChunks, documents, documentSegments, processingJobs } from "@/server/db/schema";
import { deleteDocument, getDocument, retryDocument, uploadDocument } from "@/server/documents/document-service";
import { defaultProcessingDeps, processDocument } from "@/server/documents/processing";
import { PipelineError } from "@/server/errors";
import { defaultHandlers, drainQueue, type JobHandlers } from "@/server/jobs/worker";
import { getStorage } from "@/server/storage/storage";
import { createUser, resetDatabase } from "../support/db";
import { buildDocx, buildImageOnlyPdf, buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";

const db = () => getDb();

async function chunksOf(documentId: string) {
  return db().select().from(documentChunks).where(eq(documentChunks.documentId, documentId)).orderBy(documentChunks.chunkIndex);
}

describe("document processing pipeline", () => {
  let owner: string;
  beforeEach(async () => {
    await resetDatabase();
    owner = await createUser("owner-a");
  });

  it("upload → job → extraction → chunks with embeddings and metadata → COMPLETED", async () => {
    const doc = await uploadDocument(owner, { filename: "Acme MSA.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) });
    expect(doc.status).toBe("UPLOADED");

    const [job] = await db().select().from(processingJobs).where(eq(processingJobs.documentId, doc.id));
    expect(job).toMatchObject({ type: "PROCESS_DOCUMENT", status: "QUEUED", ownerId: owner });

    expect(await drainQueue()).toBe(1);

    const processed = await getDocument(owner, doc.id);
    expect(processed).toMatchObject({ status: "COMPLETED", pageCount: 3, errorMessage: null });
    expect(processed.processedAt).not.toBeNull();

    const chunks = await chunksOf(doc.id);
    expect(chunks.length).toBe(processed.chunkCount);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.ownerId).toBe(owner);
      expect(c.embedding).toHaveLength(EMBEDDING_COLUMN_DIMENSIONS);
      expect(c.pageStart).toBeGreaterThanOrEqual(1);
      expect(c.metadata).toMatchObject({ extractor: "unpdf", embeddingModel: "local-hash@1536", fileType: "pdf" });
    }
    const liability = chunks.find((c) => c.content.includes("total aggregate liability"));
    expect(liability).toMatchObject({ pageStart: 3, pageEnd: 3 });
    expect(liability?.sectionTitle).toContain("Limitation of Liability");

    const segments = await db().select().from(documentSegments).where(eq(documentSegments.documentId, doc.id));
    expect(segments.map((s) => s.pageNumber).sort()).toEqual([1, 2, 3]);

    const [doneJob] = await db().select().from(processingJobs).where(eq(processingJobs.id, job.id));
    expect(doneJob).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
  });

  it("processes DOCX files with section metadata and no page numbers", async () => {
    const data = await buildDocx("Supply Agreement", [
      { heading: "Termination", paragraphs: ["Either party may terminate this agreement on thirty days written notice to the other party."] },
      { heading: "Governing Law", paragraphs: ["This agreement is governed by the laws of England and Wales."] },
    ]);
    const doc = await uploadDocument(owner, { filename: "supply.docx", data });
    await drainQueue();
    expect((await getDocument(owner, doc.id)).status).toBe("COMPLETED");
    const chunks = await chunksOf(doc.id);
    expect(chunks.every((c) => c.pageStart === null)).toBe(true);
    expect(chunks.some((c) => c.sectionTitle?.includes("Governing Law"))).toBe(true);
  });

  it("is idempotent: re-processing replaces chunks instead of duplicating them", async () => {
    const doc = await uploadDocument(owner, { filename: "msa.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) });
    await drainQueue();
    const first = await chunksOf(doc.id);
    await processDocument(doc.id, owner, defaultProcessingDeps());
    const second = await chunksOf(doc.id);
    expect(second.length).toBe(first.length);
    expect(second.map((c) => c.chunkIndex)).toEqual(first.map((c) => c.chunkIndex));
    expect(new Set(second.map((c) => c.id)).size).toBe(second.length);
  });

  it("retries transient failures with backoff and succeeds without duplicates", async () => {
    const doc = await uploadDocument(owner, { filename: "msa.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) });
    let calls = 0;
    const flaky: JobHandlers = {
      ...defaultHandlers,
      processDocument: async (job) => {
        calls++;
        if (calls === 1) throw new PipelineError("TRANSIENT", "Embedding provider timed out.", { retryable: true });
        return defaultHandlers.processDocument(job);
      },
    };
    await drainQueue(db(), flaky);
    const afterFailure = await getDocument(owner, doc.id);
    expect(afterFailure.status).toBe("PROCESSING");
    expect(afterFailure.errorMessage).toMatch(/retrying automatically \(attempt 2 of 3\)/);

    // Fast-forward the backoff and run again.
    await db().update(processingJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(processingJobs.documentId, doc.id));
    await drainQueue(db(), flaky);
    const recovered = await getDocument(owner, doc.id);
    expect(recovered.status).toBe("COMPLETED");
    const [job] = await db().select().from(processingJobs).where(eq(processingJobs.documentId, doc.id));
    expect(job).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect((await chunksOf(doc.id)).length).toBe(recovered.chunkCount);
  });

  it("marks permanent failures FAILED with a user-safe message, and supports manual retry", async () => {
    const doc = await uploadDocument(owner, { filename: "scan.pdf", data: await buildImageOnlyPdf() });
    await drainQueue();
    const failed = await getDocument(owner, doc.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toMatch(/scanned images; OCR is not supported/);
    const [job] = await db().select().from(processingJobs).where(eq(processingJobs.documentId, doc.id));
    expect(job).toMatchObject({ status: "FAILED", attempts: 1 }); // non-retryable: no wasted attempts

    await retryDocument(owner, doc.id);
    expect((await getDocument(owner, doc.id)).status).toBe("UPLOADED");
    const jobs = await db().select().from(processingJobs).where(and(eq(processingJobs.documentId, doc.id), eq(processingJobs.status, "QUEUED")));
    expect(jobs).toHaveLength(1);
    await expect(retryDocument(owner, doc.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects duplicate uploads of identical content for the same user", async () => {
    const data = await buildPdf(SAMPLE_CONTRACT_PAGES);
    await uploadDocument(owner, { filename: "a.pdf", data });
    await expect(uploadDocument(owner, { filename: "b.pdf", data })).rejects.toMatchObject({ code: "CONFLICT" });
    // A different user may upload the same file.
    const other = await createUser("owner-b");
    await expect(uploadDocument(other, { filename: "a.pdf", data })).resolves.toBeTruthy();
  });

  it("deletes the document, its chunks/segments/jobs (cascade) and the stored file", async () => {
    const doc = await uploadDocument(owner, { filename: "msa.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) });
    await drainQueue();
    const [row] = await db().select({ key: documents.storageKey }).from(documents).where(eq(documents.id, doc.id));
    await deleteDocument(owner, doc.id);
    expect(await chunksOf(doc.id)).toHaveLength(0);
    expect(await db().select().from(documentSegments).where(eq(documentSegments.documentId, doc.id))).toHaveLength(0);
    expect(await db().select().from(processingJobs).where(eq(processingJobs.documentId, doc.id))).toHaveLength(0);
    await expect(getStorage().get(row.key)).rejects.toThrow();
  });

  it("enforces ownership on every document operation", async () => {
    const doc = await uploadDocument(owner, { filename: "msa.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) });
    const intruder = await createUser("intruder");
    await expect(getDocument(intruder, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteDocument(intruder, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(retryDocument(intruder, doc.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getDocument(owner, doc.id)).id).toBe(doc.id);
  });
});
