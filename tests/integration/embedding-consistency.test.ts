import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalHashEmbedder, setEmbedderOverride, type Embedder } from "@/server/ai/embeddings";
import { getDb } from "@/server/db/client";
import { documents, processingJobs } from "@/server/db/schema";
import { uploadDocument } from "@/server/documents/document-service";
import { findStaleDocuments, requeueForReembedding } from "@/server/documents/embedding-consistency";
import { drainQueue } from "@/server/jobs/worker";
import { retrieve } from "@/server/retrieval/retrieval-service";
import { createUser, resetDatabase } from "../support/db";
import { buildDocx, buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";

/** Same vectors as local-hash, but a different model id – simulates switching embedding models. */
class RenamedEmbedder implements Embedder {
  readonly id = "openai:text-embedding-3-small@1536";
  readonly dimensions = 1536;
  private readonly inner = new LocalHashEmbedder();
  embedDocuments(values: string[]) {
    return this.inner.embedDocuments(values);
  }
  embedQuery(value: string) {
    return this.inner.embedQuery(value);
  }
}

describe("embedding-model consistency", () => {
  let owner: string;
  let oldDoc: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUser("emb-owner");
    oldDoc = (await uploadDocument(owner, { filename: "acme.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) })).id; // indexed with local-hash
    await drainQueue();
  });
  afterEach(() => setEmbedderOverride(undefined));

  it("never compares query vectors against chunks from a different embedding model", async () => {
    setEmbedderOverride(new RenamedEmbedder());
    const { chunks, stats } = await retrieve({ ownerId: owner, queries: ["terminate this Agreement for any reason"] });
    expect(stats.vectorCandidates).toBe(0); // old-model vectors are excluded from the vector arm…
    expect(chunks.length).toBeGreaterThan(0); // …but the document stays findable through full-text search
  });

  it("re-embeds only documents whose chunks came from another model", async () => {
    setEmbedderOverride(new RenamedEmbedder());
    const fresh = (
      await uploadDocument(owner, {
        filename: "nda.docx",
        data: await buildDocx("NDA", [{ heading: "Confidentiality", paragraphs: ["Each party shall keep confidential information secret."] }]),
      })
    ).id;
    await drainQueue(); // indexed with the new model

    const stale = await findStaleDocuments(getDb(), "openai:text-embedding-3-small@1536");
    expect(stale.map((d) => d.id)).toEqual([oldDoc]);
    expect(stale[0].embeddingModels).toEqual(["local-hash@1536"]);

    expect(await requeueForReembedding(getDb(), stale)).toBe(1);
    const queued = await getDb().select().from(processingJobs).where(eq(processingJobs.status, "QUEUED"));
    expect(queued.map((j) => j.documentId)).toEqual([oldDoc]);
    const [freshRow] = await getDb().select().from(documents).where(eq(documents.id, fresh));
    expect(freshRow.status).toBe("COMPLETED"); // untouched

    await drainQueue();
    expect(await findStaleDocuments(getDb(), "openai:text-embedding-3-small@1536")).toEqual([]);
    const { stats } = await retrieve({ ownerId: owner, queries: ["terminate this Agreement for any reason"], documentIds: [oldDoc] });
    expect(stats.vectorCandidates).toBeGreaterThan(0);
  });
});
