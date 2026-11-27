import { eq } from "drizzle-orm";
import type { ModelHandle } from "@/server/ai/models";
import type { RiskSeverity } from "@/lib/domain";
import type { CallRecord } from "./metering";
import type { EvalContract } from "./dataset";
import { clauseIdentification, evidenceCovers, maxSeverity, severityBias, severityDistance, severityInBand } from "./metrics";

/** Risk-analysis evaluation for one contract and one run. */

export interface CategorySeverityRow {
  category: string;
  observed: RiskSeverity | null;
  band: [RiskSeverity, RiskSeverity];
  inBand: boolean;
  distance: number;
  bias: -1 | 0 | 1;
}

export interface RiskRunRow {
  contract: string;
  split: string;
  run: number;
  status: string;
  identification: ReturnType<typeof clauseIdentification>;
  severity: CategorySeverityRow[];
  /** Categories with evidencePhrases → whether a verified quote for that category contains one. */
  evidenceCoverage: Record<string, boolean>;
  findingsKept: number;
  findingsDiscarded: number;
  /** Findings whose model-proposed severity was changed by calibration. */
  severityAdjustments: number;
  structuredAttempts: number;
  structuredFailures: number;
  findings: { category: string; severity: string; title: string; rationale: unknown }[];
}

export interface RiskDeps {
  ownerId: string;
  model: ModelHandle;
  calls: CallRecord[];
  setPurpose: (p: string) => void;
}

export async function evaluateRiskRun(contract: EvalContract, documentId: string, run: number, deps: RiskDeps): Promise<RiskRunRow> {
  const { getDb } = await import("@/server/db/client");
  const { processingJobs } = await import("@/server/db/schema");
  const { getEmbedder } = await import("@/server/ai/embeddings");
  const { normalizeForMatch } = await import("@/server/risk/evidence");
  const { startRiskAnalysis, runRiskAnalysis, getAnalysis } = await import("@/server/risk/risk-service");
  const db = getDb();

  deps.setPurpose("risk");
  const analysis = await startRiskAnalysis(deps.ownerId, documentId, contract.perspective);
  await db.delete(processingJobs).where(eq(processingJobs.analysisId, analysis.id)); // run inline with the metered model
  const callsBefore = deps.calls.length;
  await runRiskAnalysis(analysis.id, deps.ownerId, { db, model: deps.model, retrievalDeps: { db, embedder: getEmbedder() } });
  const { analysis: result, findings } = await getAnalysis(deps.ownerId, analysis.id);
  const structuredAttempts = deps.calls.slice(callsBefore).filter((c) => c.structured).length;

  const expectations = contract.riskExpectations;
  const identified = new Set(result.categoryCoverage.filter((c) => c.outcome === "IDENTIFIED").map((c) => c.category as string));
  const severity: CategorySeverityRow[] = Object.entries(expectations.severityBands).map(([category, band]) => {
    const observed = maxSeverity(findings.filter((f) => f.category === category).map((f) => f.severity));
    return { category, observed, band, inBand: severityInBand(observed, band), distance: severityDistance(observed, band), bias: severityBias(observed, band) };
  });

  const evidenceCoverage: Record<string, boolean> = {};
  for (const [category, phrases] of Object.entries(expectations.evidencePhrases)) {
    const coverage = result.categoryCoverage.find((c) => c.category === category);
    const quotes = [
      ...(coverage?.outcome === "IDENTIFIED" ? (coverage.evidence ?? []) : []),
      ...findings.filter((f) => f.category === category).flatMap((f) => f.evidence),
    ].map((e) => e.quote);
    evidenceCoverage[category] = evidenceCovers(quotes, phrases, normalizeForMatch);
  }

  const rationale = (f: (typeof findings)[number]) => ("severityRationale" in f ? (f as { severityRationale: unknown }).severityRationale : null);
  return {
    contract: contract.id,
    split: contract.split,
    run,
    status: result.status,
    identification: clauseIdentification(identified, expectations.identified, expectations.notIdentified),
    severity,
    evidenceCoverage,
    findingsKept: findings.length,
    findingsDiscarded: result.categoryCoverage.reduce((n, c) => n + c.discardedFindings, 0),
    severityAdjustments: findings.filter((f) => (rationale(f) as { adjusted?: boolean } | null)?.adjusted).length,
    structuredAttempts,
    structuredFailures: result.categoryCoverage.filter((c) => c.outcome === "ERROR").length + (result.profile ? 0 : 1),
    findings: findings.map((f) => ({ category: f.category, severity: f.severity, title: f.title, rationale: rationale(f) })),
  };
}
