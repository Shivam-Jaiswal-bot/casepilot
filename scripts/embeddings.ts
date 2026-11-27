/**
 * Embedding-model consistency check.
 *   npm run embeddings            # list documents embedded with a different model than the configured one
 *   npm run embeddings -- --reindex   # re-queue ONLY those documents (the worker re-embeds them)
 */
import "dotenv/config";
import { getEmbedder } from "@/server/ai/embeddings";
import { closeDb, getDb } from "@/server/db/client";
import { findStaleDocuments, requeueForReembedding } from "@/server/documents/embedding-consistency";

async function main() {
  const embedder = getEmbedder();
  const db = getDb();
  const stale = await findStaleDocuments(db, embedder.id);
  console.log(`Configured embedder: ${embedder.id}`);
  if (stale.length === 0) {
    console.log("All indexed documents use the configured embedder. Nothing to re-embed.");
    return;
  }
  console.log(`${stale.length} document(s) were embedded with a different model:`);
  for (const d of stale) console.log(`  - ${d.id}  ${d.title}  [${d.embeddingModels.join(", ")}]`);
  if (process.argv.includes("--reindex")) {
    const n = await requeueForReembedding(db, stale);
    console.log(`Queued ${n} document(s) for re-embedding. Run the worker (or the dev server) to process them.`);
  } else {
    console.log("Run with --reindex to re-embed only these documents.");
  }
}

main()
  .catch((err: unknown) => {
    console.error("Embedding check failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
