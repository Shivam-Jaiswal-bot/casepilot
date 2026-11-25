import { sql, type SQL } from "drizzle-orm";
import { getEmbedder, type Embedder } from "@/server/ai/embeddings";
import { getEnv } from "@/server/config/env";
import { getDb, type Database } from "@/server/db/client";
import { logger } from "@/server/logging/logger";
import {
  dedupeCandidates,
  reciprocalRankFusion,
  selectWithinBudget,
  toOrTsQuery,
  type Candidate,
  type FusedCandidate,
  type RankedList,
} from "./ranking";

export interface RetrievalRequest {
  /** Tenant boundary. Mandatory: every SQL statement below filters on it. */
  ownerId: string;
  /** One or more query phrasings; results are fused across all of them. */
  queries: string[];
  /** Restrict to these documents; omit to search all of the owner's completed documents. */
  documentIds?: string[];
  topK?: number;
  tokenBudget?: number;
}

export interface RetrievalResult {
  chunks: FusedCandidate[];
  /** Diagnostics for evaluation / audit (no text). */
  stats: { vectorCandidates: number; textCandidates: number; fused: number; afterDedupe: number; bestSimilarity: number | null };
}

export interface RetrievalDeps {
  db: Database;
  embedder: Embedder;
}

interface ChunkRow extends Record<string, unknown> {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  content: string;
  token_count: number;
  spans: Candidate["spans"] | null;
  score: number;
}

function toCandidate(r: ChunkRow): Candidate {
  return {
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    sectionTitle: r.section_title,
    content: r.content,
    tokenCount: r.token_count,
    spans: r.spans ?? undefined,
  };
}

/**
 * Tenant + scope predicate shared by both retrieval arms. Ownership is checked
 * on BOTH the chunk and its parent document (defence in depth), and only fully
 * indexed documents are searchable.
 */
function scopePredicate(ownerId: string, documentIds?: string[]): SQL {
  const base = sql`c.owner_id = ${ownerId} and d.owner_id = ${ownerId} and d.status = 'COMPLETED'`;
  if (!documentIds) return base;
  if (documentIds.length === 0) return sql`false`;
  return sql`${base} and c.document_id in (${sql.join(
    documentIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

const SELECT_COLUMNS = sql`c.id as chunk_id, c.document_id, d.title as document_title, c.chunk_index,
  c.page_start, c.page_end, c.section_title, c.content, c.token_count, c.metadata->'spans' as spans`;

async function vectorSearch(db: Database, embedding: number[], scope: SQL, limit: number): Promise<ChunkRow[]> {
  const vector = JSON.stringify(embedding);
  return db.transaction(async (tx) => {
    // Larger candidate list for the HNSW graph walk, and iterative scans
    // (pgvector ≥ 0.8) so tenant/document filters don't starve the result set.
    await tx.execute(sql`set local hnsw.ef_search = 100`);
    await tx.execute(sql`set local hnsw.iterative_scan = 'relaxed_order'`);
    return (await tx.execute(sql`
      select ${SELECT_COLUMNS}, 1 - (c.embedding <=> ${vector}::vector) as score
      from document_chunks c
      join documents d on d.id = c.document_id
      where ${scope}
      order by c.embedding <=> ${vector}::vector
      limit ${limit}
    `)) as unknown as ChunkRow[];
  });
}

async function textSearch(db: Database, tsquery: string, scope: SQL, limit: number): Promise<ChunkRow[]> {
  return (await db.execute(sql`
    select ${SELECT_COLUMNS}, ts_rank_cd(c.search_vector, q.query, 32) as score
    from document_chunks c
    join documents d on d.id = c.document_id,
         to_tsquery('english', ${tsquery}) as q(query)
    where ${scope} and c.search_vector @@ q.query
    order by score desc, c.chunk_index
    limit ${limit}
  `)) as unknown as ChunkRow[];
}

/**
 * Hybrid retrieval: pgvector semantic search + Postgres full-text search,
 * fused with Reciprocal Rank Fusion, de-duplicated and packed into a token budget.
 *
 * Full-text search matters for legal text: defined terms, section numbers and
 * exact phrases ("Limitation of Liability", "Section 12.2") are matched
 * precisely by lexical search even when embeddings blur them.
 */
export async function retrieve(req: RetrievalRequest, deps: RetrievalDeps = { db: getDb(), embedder: getEmbedder() }): Promise<RetrievalResult> {
  const env = getEnv();
  const started = Date.now();
  const queries = req.queries.map((q) => q.trim()).filter(Boolean);
  if (queries.length === 0) {
    return { chunks: [], stats: { vectorCandidates: 0, textCandidates: 0, fused: 0, afterDedupe: 0, bestSimilarity: null } };
  }

  const scope = scopePredicate(req.ownerId, req.documentIds);
  const candidates = env.RETRIEVAL_CANDIDATES;
  const embeddings = await deps.embedder.embedDocuments(queries);

  const lists: RankedList[] = [];
  let vectorCount = 0;
  let textCount = 0;
  let bestSimilarity: number | null = null;

  await Promise.all(
    queries.map(async (query, i) => {
      const [vectorRows, textRows] = await Promise.all([
        vectorSearch(deps.db, embeddings[i], scope, candidates),
        (async () => {
          const tsq = toOrTsQuery(query);
          return tsq ? textSearch(deps.db, tsq, scope, candidates) : [];
        })(),
      ]);
      for (const r of vectorRows) bestSimilarity = Math.max(bestSimilarity ?? -1, Number(r.score));
      // Vector search always returns *something*; drop hits that are not even weakly similar.
      const relevantVector = vectorRows.filter((r) => Number(r.score) >= env.RETRIEVAL_MIN_VECTOR_SIMILARITY);
      vectorCount += relevantVector.length;
      textCount += textRows.length;
      lists.push({ kind: "vector", items: relevantVector.map(toCandidate) });
      lists.push({ kind: "text", items: textRows.map(toCandidate) });
    }),
  );

  const fused = reciprocalRankFusion(lists);
  const deduped = dedupeCandidates(fused);
  const selected = selectWithinBudget(deduped, req.topK ?? env.RETRIEVAL_TOP_K, req.tokenBudget ?? env.CONTEXT_TOKEN_BUDGET);

  logger.debug("retrieval.done", {
    queries: queries.length,
    vector: vectorCount,
    text: textCount,
    selected: selected.length,
    ms: Date.now() - started,
  });

  return {
    chunks: selected,
    stats: { vectorCandidates: vectorCount, textCandidates: textCount, fused: fused.length, afterDedupe: deduped.length, bestSimilarity },
  };
}
