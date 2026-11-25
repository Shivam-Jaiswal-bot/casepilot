import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { generateText, Output } from "ai";
import {
  CLAUSE_CATEGORIES,
  emptySeverityCounts,
  RISK_SEVERITIES,
  type CategoryCoverage,
  type ClauseCategory,
} from "@/lib/domain";
import { getModel, type ModelHandle } from "@/server/ai/models";
import { getEmbedder } from "@/server/ai/embeddings";
import { getEnv } from "@/server/config/env";
import { getDb, type Database } from "@/server/db/client";
import { documentChunks, documents, riskAnalyses, riskFindings, type ContractProfile } from "@/server/db/schema";
import { AppError, notFound, PipelineError, toPipelineError } from "@/server/errors";
import { getDocument, isUuid } from "@/server/documents/document-service";
import { enqueueJob } from "@/server/jobs/job-queue";
import { logger } from "@/server/logging/logger";
import type { ValidatableSource } from "@/server/rag/citations";
import { retrieve, type RetrievalDeps } from "@/server/retrieval/retrieval-service";
import { CATEGORY_PLAYBOOK } from "./categories";
import { verifyClauseEvidence, verifyFindings, type VerifiedFinding } from "./evidence";
import { buildCategoryPrompt, buildProfilePrompt, PROFILE_INSTRUCTIONS, RISK_REVIEW_INSTRUCTIONS } from "./prompts";
import { categoryEvaluationSchema, contractProfileSchema } from "./schema";

export type RiskAnalysisRecord = typeof riskAnalyses.$inferSelect;
export type RiskFindingRecord = typeof riskFindings.$inferSelect;

const CATEGORY_CONCURRENCY = 3;
const EVIDENCE_TOP_K = 6;
const EVIDENCE_TOKEN_BUDGET = 3500;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function startRiskAnalysis(
  ownerId: string,
  documentId: string,
  perspective: string | null,
  db: Database = getDb(),
): Promise<RiskAnalysisRecord> {
  const doc = await getDocument(ownerId, documentId, db);
  if (doc.status !== "COMPLETED") {
    throw new AppError("CONFLICT", "The document must finish processing before it can be analysed.");
  }
  // Fail fast (503 NOT_CONFIGURED) instead of queueing a job that cannot succeed.
  getModel("primary");
  const [running] = await db
    .select({ id: riskAnalyses.id })
    .from(riskAnalyses)
    .where(and(eq(riskAnalyses.documentId, doc.id), inArray(riskAnalyses.status, ["QUEUED", "RUNNING"])));
  if (running) throw new AppError("CONFLICT", "A risk analysis is already in progress for this document.", { analysisId: running.id });

  return db.transaction(async (tx) => {
    const [analysis] = await tx
      .insert(riskAnalyses)
      .values({ ownerId, documentId: doc.id, perspective: perspective?.trim() || null, status: "QUEUED" })
      .returning();
    await enqueueJob(tx, {
      type: "ANALYZE_RISK",
      ownerId,
      documentId: doc.id,
      analysisId: analysis.id,
      maxAttempts: getEnv().JOB_MAX_ATTEMPTS,
    });
    return analysis;
  });
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

export interface RiskDeps {
  db: Database;
  model: ModelHandle;
  retrievalDeps: RetrievalDeps;
}

export function defaultRiskDeps(): RiskDeps {
  const db = getDb();
  return { db, model: getModel("primary"), retrievalDeps: { db, embedder: getEmbedder() } };
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildProfile(db: Database, model: ModelHandle, ownerId: string, documentId: string, title: string) {
  // The opening chunks usually hold the title, parties and recitals.
  const opening = await db
    .select()
    .from(documentChunks)
    .where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.ownerId, ownerId)))
    .orderBy(asc(documentChunks.chunkIndex))
    .limit(3);
  if (opening.length === 0) return null;
  const sources = opening.map((c, i) => ({
    id: `S${i + 1}`,
    documentTitle: title,
    pageStart: c.pageStart,
    pageEnd: c.pageEnd,
    sectionTitle: c.sectionTitle,
    content: c.content,
  }));
  const { output } = await generateText({
    model: model.model,
    instructions: PROFILE_INSTRUCTIONS,
    prompt: buildProfilePrompt(sources),
    output: Output.object({ schema: contractProfileSchema }),
    maxOutputTokens: model.maxOutputTokens,
    providerOptions: model.providerOptions,
  });
  return output satisfies ContractProfile;
}

interface CategoryResult {
  coverage: CategoryCoverage;
  findings: (VerifiedFinding & { category: ClauseCategory })[];
  /** True when evidence was retrieved and the model was asked to evaluate it. */
  evaluated: boolean;
  transientError: boolean;
}

async function evaluateCategory(
  deps: RiskDeps,
  ctx: { ownerId: string; documentId: string; profile: ContractProfile | null; perspective: string | null },
  category: ClauseCategory,
): Promise<CategoryResult> {
  try {
    const retrieval = await retrieve(
      {
        ownerId: ctx.ownerId,
        documentIds: [ctx.documentId],
        queries: CATEGORY_PLAYBOOK[category].queries,
        topK: EVIDENCE_TOP_K,
        tokenBudget: EVIDENCE_TOKEN_BUDGET,
      },
      deps.retrievalDeps,
    );
    if (retrieval.chunks.length === 0) {
      return {
        coverage: { category, outcome: "NOT_IDENTIFIED", summary: "Not identified in the reviewed content.", findingCount: 0, discardedFindings: 0 },
        findings: [],
        evaluated: false,
        transientError: false,
      };
    }
    const sources: ValidatableSource[] = retrieval.chunks.map((c, i) => ({ ...c, id: `S${i + 1}` }));
    const { output } = await generateText({
      model: deps.model.model,
      instructions: RISK_REVIEW_INSTRUCTIONS,
      prompt: buildCategoryPrompt({ category, profile: ctx.profile, perspective: ctx.perspective, sources }),
      output: Output.object({ schema: categoryEvaluationSchema }),
      maxOutputTokens: deps.model.maxOutputTokens,
      providerOptions: deps.model.providerOptions,
    });
    const { findings, discarded } = verifyFindings(output, sources);
    const clauseEvidence = verifyClauseEvidence(output.clauseEvidence, sources);
    // A category counts as identified only when the provision is shown by verified
    // quotes (its own clause evidence or a finding's). The model's say-so is not enough.
    const identified = findings.length > 0 || clauseEvidence.length > 0;
    const unverifiedClaim = !identified && output.clauseStatus === "PRESENT";
    return {
      coverage: {
        category,
        outcome: identified ? "IDENTIFIED" : "NOT_IDENTIFIED",
        summary: identified
          ? output.summary
          : unverifiedClaim
            ? "Not identified in the reviewed content (a candidate provision was proposed but its quotation could not be verified)."
            : "Not identified in the reviewed content.",
        findingCount: findings.length,
        discardedFindings: discarded,
        evidence: identified ? (clauseEvidence.length ? clauseEvidence : findings[0].evidence) : [],
      },
      findings: findings.map((f) => ({ ...f, category })),
      evaluated: true,
      transientError: false,
    };
  } catch (err) {
    const pe = toPipelineError(err);
    logger.warn("risk.category_failed", { category, code: pe.code, error: err });
    return {
      coverage: { category, outcome: "ERROR", summary: "This category could not be evaluated.", findingCount: 0, discardedFindings: 0 },
      findings: [],
      evaluated: true,
      transientError: pe.retryable,
    };
  }
}

const severityRank = (s: string) => RISK_SEVERITIES.indexOf(s as (typeof RISK_SEVERITIES)[number]);

/**
 * Runs a queued analysis. Idempotent: findings for the analysis are replaced
 * atomically, so a retried job never duplicates findings.
 */
export async function runRiskAnalysis(analysisId: string, ownerId: string, deps: RiskDeps): Promise<void> {
  const { db } = deps;
  const [analysis] = await db
    .select()
    .from(riskAnalyses)
    .where(and(eq(riskAnalyses.id, analysisId), eq(riskAnalyses.ownerId, ownerId)));
  if (!analysis) throw new PipelineError("ANALYSIS_GONE", "The analysis no longer exists.", { retryable: false });
  const doc = await getDocument(ownerId, analysis.documentId, db);

  await db
    .update(riskAnalyses)
    .set({ status: "RUNNING", startedAt: new Date(), errorMessage: null, model: deps.model.label })
    .where(eq(riskAnalyses.id, analysisId));

  const profile = await buildProfile(db, deps.model, ownerId, doc.id, doc.title).catch((err: unknown) => {
    logger.warn("risk.profile_failed", { analysisId, error: err });
    return null;
  });

  const ctx = { ownerId, documentId: doc.id, profile, perspective: analysis.perspective };
  const results = await mapWithConcurrency(CLAUSE_CATEGORIES, CATEGORY_CONCURRENCY, (c) => evaluateCategory(deps, ctx, c));

  const errored = results.filter((r) => r.coverage.outcome === "ERROR");
  const evaluated = results.filter((r) => r.evaluated);
  // If every category that needed a model evaluation failed, the report would be
  // empty-but-"complete" and therefore misleading: fail the analysis instead.
  if (evaluated.length > 0 && errored.length === evaluated.length) {
    throw new PipelineError("ANALYSIS_FAILED", "The risk analysis could not evaluate any clause category.", {
      retryable: errored.some((r) => r.transientError),
    });
  }

  const findings = results
    .flatMap((r) => r.findings)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const counts = emptySeverityCounts();
  for (const f of findings) counts[f.severity]++;

  await db.transaction(async (tx) => {
    await tx.delete(riskFindings).where(eq(riskFindings.analysisId, analysisId));
    if (findings.length) {
      await tx.insert(riskFindings).values(
        findings.map((f, i) => ({
          analysisId,
          documentId: doc.id,
          ownerId,
          category: f.category,
          title: f.title,
          severity: f.severity,
          explanation: f.explanation,
          businessImplication: f.businessImplication,
          reviewSuggestion: f.reviewSuggestion,
          confidence: f.confidence,
          basis: f.basis,
          evidence: f.evidence,
          sortOrder: i,
        })),
      );
    }
    await tx
      .update(riskAnalyses)
      .set({
        status: "COMPLETED",
        profile,
        categoryCoverage: results.map((r) => r.coverage),
        severityCounts: counts,
        errorMessage: errored.length ? `${errored.length} categor${errored.length === 1 ? "y" : "ies"} could not be evaluated.` : null,
        completedAt: new Date(),
      })
      .where(eq(riskAnalyses.id, analysisId));
    await tx.update(documents).set({ lastAnalyzedAt: new Date() }).where(eq(documents.id, doc.id));
  });

  logger.info("risk.completed", {
    analysisId,
    findings: findings.length,
    discarded: results.reduce((n, r) => n + r.coverage.discardedFindings, 0),
    errors: errored.length,
  });
}

export async function markAnalysisFailed(db: Database, analysisId: string, message: string): Promise<void> {
  await db.update(riskAnalyses).set({ status: "FAILED", errorMessage: message, completedAt: new Date() }).where(eq(riskAnalyses.id, analysisId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAnalysis(ownerId: string, analysisId: string, db: Database = getDb()) {
  if (!isUuid(analysisId)) throw notFound("Analysis");
  const [analysis] = await db
    .select()
    .from(riskAnalyses)
    .where(and(eq(riskAnalyses.id, analysisId), eq(riskAnalyses.ownerId, ownerId)));
  if (!analysis) throw notFound("Analysis");
  const findings = await db
    .select()
    .from(riskFindings)
    .where(and(eq(riskFindings.analysisId, analysisId), eq(riskFindings.ownerId, ownerId)))
    .orderBy(asc(riskFindings.sortOrder));
  return { analysis, findings };
}

export async function getLatestAnalysisForDocument(ownerId: string, documentId: string, db: Database = getDb()) {
  const [latest] = await db
    .select({ id: riskAnalyses.id })
    .from(riskAnalyses)
    .where(and(eq(riskAnalyses.documentId, documentId), eq(riskAnalyses.ownerId, ownerId)))
    .orderBy(desc(riskAnalyses.createdAt))
    .limit(1);
  return latest ? getAnalysis(ownerId, latest.id, db) : null;
}

export async function listRecentAnalyses(ownerId: string, limit = 5, db: Database = getDb()) {
  return db
    .select({
      id: riskAnalyses.id,
      documentId: riskAnalyses.documentId,
      documentTitle: documents.title,
      status: riskAnalyses.status,
      severityCounts: riskAnalyses.severityCounts,
      createdAt: riskAnalyses.createdAt,
      completedAt: riskAnalyses.completedAt,
    })
    .from(riskAnalyses)
    .innerJoin(documents, and(eq(documents.id, riskAnalyses.documentId), eq(documents.ownerId, ownerId)))
    .where(eq(riskAnalyses.ownerId, ownerId))
    .orderBy(desc(riskAnalyses.createdAt))
    .limit(limit);
}

export async function getFinding(ownerId: string, findingId: string, db: Database = getDb()) {
  if (!isUuid(findingId)) throw notFound("Finding");
  const [finding] = await db
    .select()
    .from(riskFindings)
    .where(and(eq(riskFindings.id, findingId), eq(riskFindings.ownerId, ownerId)));
  if (!finding) throw notFound("Finding");
  // Resolve the full text of each evidence chunk so reviewers see the quote in context.
  const chunkIds = finding.evidence.map((e) => e.chunkId);
  const chunks = chunkIds.length
    ? await db
        .select({ id: documentChunks.id, content: documentChunks.content })
        .from(documentChunks)
        .where(and(inArray(documentChunks.id, chunkIds), eq(documentChunks.ownerId, ownerId)))
    : [];
  return { finding, chunkText: new Map(chunks.map((c) => [c.id, c.content])) };
}

/** Count of findings at each severity across all of an owner's latest analyses (dashboard). */
export async function countOpenAnalyses(ownerId: string, db: Database = getDb()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(riskAnalyses)
    .where(and(eq(riskAnalyses.ownerId, ownerId), inArray(riskAnalyses.status, ["QUEUED", "RUNNING"])));
  return row.n;
}
