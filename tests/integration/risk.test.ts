import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setModelOverride } from "@/server/ai/models";
import { getDb } from "@/server/db/client";
import { riskFindings } from "@/server/db/schema";
import { getDocument, uploadDocument } from "@/server/documents/document-service";
import { drainQueue } from "@/server/jobs/worker";
import { defaultRiskDeps, getAnalysis, getFinding, runRiskAnalysis, startRiskAnalysis } from "@/server/risk/risk-service";
import { createUser, resetDatabase } from "../support/db";
import { buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";
import { scriptedModel } from "../support/mock-llm";
import { reviewer } from "../support/risk-reviewer";

describe("contract risk analysis", () => {
  let owner: string;
  let documentId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await createUser("risk-owner");
    documentId = (await uploadDocument(owner, { filename: "acme.pdf", data: await buildPdf(SAMPLE_CONTRACT_PAGES) })).id;
    await drainQueue();
    setModelOverride({ primary: scriptedModel(reviewer).handle });
  });
  afterEach(() => setModelOverride({}));

  it("produces evidence-backed findings, discards unsupported ones and separates NOT_IDENTIFIED", async () => {
    const started = await startRiskAnalysis(owner, documentId, "We are the Customer");
    expect(started.status).toBe("QUEUED");
    await drainQueue();

    const { analysis, findings } = await getAnalysis(owner, started.id);
    expect(analysis.status).toBe("COMPLETED");
    expect(analysis.profile).toMatchObject({ contractType: "Master Services Agreement" });

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f).toMatchObject({ category: "TERMINATION", severity: "HIGH", basis: "EXPLICIT", confidence: "HIGH" });
    expect(f.evidence[0]).toMatchObject({
      pageStart: 2,
      pageEnd: 2,
      match: "EXACT",
      sectionTitle: "3. Term and Termination › 3.2 Termination for Convenience",
    });
    expect(analysis.severityCounts).toMatchObject({ HIGH: 1, CRITICAL: 0 });

    const coverage = Object.fromEntries(analysis.categoryCoverage.map((c) => [c.category, c]));
    expect(coverage.TERMINATION).toMatchObject({ outcome: "IDENTIFIED", findingCount: 1 });
    // The fabricated indemnity finding was discarded, and the model's unverifiable
    // claim that an indemnity clause exists does NOT make the category "identified".
    expect(coverage.INDEMNIFICATION).toMatchObject({ outcome: "NOT_IDENTIFIED", findingCount: 0, discardedFindings: 1 });
    expect(coverage.INDEMNIFICATION.summary).toMatch(/could not be verified/);
    // Present but balanced: identified via verified clause evidence, no findings, located precisely.
    expect(coverage.GOVERNING_LAW).toMatchObject({ outcome: "IDENTIFIED", findingCount: 0 });
    expect(coverage.GOVERNING_LAW.evidence?.[0]).toMatchObject({ pageStart: 3, pageEnd: 3, sectionTitle: "5. Governing Law" });
    // Missing clauses are reported as not identified – never as findings.
    expect(coverage.FORCE_MAJEURE).toMatchObject({ outcome: "NOT_IDENTIFIED", summary: "Not identified in the reviewed content." });
    expect(analysis.categoryCoverage).toHaveLength(15);

    expect((await getDocument(owner, documentId)).lastAnalyzedAt).not.toBeNull();

    const detail = await getFinding(owner, f.id);
    expect(detail.chunkText.get(f.evidence[0].chunkId)).toContain("ten (10) days written notice");
  });

  it("re-running an analysis replaces findings instead of duplicating them", async () => {
    const started = await startRiskAnalysis(owner, documentId, null);
    await drainQueue();
    await runRiskAnalysis(started.id, owner, defaultRiskDeps());
    const rows = await getDb().select().from(riskFindings).where(eq(riskFindings.analysisId, started.id));
    expect(rows).toHaveLength(1);
  });

  it("prevents concurrent analyses and cross-tenant access", async () => {
    const started = await startRiskAnalysis(owner, documentId, null);
    await expect(startRiskAnalysis(owner, documentId, null)).rejects.toMatchObject({ code: "CONFLICT" });
    const intruder = await createUser("intruder");
    await expect(startRiskAnalysis(intruder, documentId, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAnalysis(intruder, started.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await drainQueue();
    const { findings } = await getAnalysis(owner, started.id);
    await expect(getFinding(intruder, findings[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records an ERROR outcome per category when the model output is invalid, without failing the whole analysis", async () => {
    setModelOverride({
      primary: scriptedModel((p) => (p.includes("Clause category under review: Payment obligations") ? "not json" : reviewer(p))).handle,
    });
    const started = await startRiskAnalysis(owner, documentId, null);
    await drainQueue();
    const { analysis } = await getAnalysis(owner, started.id);
    expect(analysis.status).toBe("COMPLETED");
    expect(analysis.categoryCoverage.find((c) => c.category === "PAYMENT")?.outcome).toBe("ERROR");
    expect(analysis.errorMessage).toMatch(/1 category could not be evaluated/);
  });

  it("fails the analysis when every category fails", async () => {
    setModelOverride({ primary: scriptedModel(() => "not json").handle });
    const started = await startRiskAnalysis(owner, documentId, null);
    await drainQueue();
    const { analysis } = await getAnalysis(owner, started.id);
    expect(analysis.status).toBe("FAILED");
    expect(analysis.errorMessage).toMatch(/could not evaluate any clause category/);
  });
});
