/**
 * CasePilot evaluation harness.
 *
 *   npm run eval                                          # retrieval only (no LLM calls)
 *   npm run eval -- --with-llm                            # + answers, citations, risk analysis, cost, latency
 *   npm run eval -- --with-llm --provider openai --model gpt-6-luna --judge openai:gpt-6-luna
 *   npm run eval -- --with-llm --provider deepseek --model deepseek-v4-pro --judge openai:gpt-6-luna
 *   npm run eval:compare -- evals/results/a.json evals/results/b.json
 *
 * Options: --dataset <path> (default contract-qa.v3), --k <n> (answer context size), --recall-ks 1,3,5,8,
 *   --risk-repeats <n> (repeat risk analysis to measure severity stability), --contracts a,b, --split dev|holdout,
 *   --skip-answers, --skip-risk, --pricing <path>, --label <text>.
 *   --self-test  Runs the full --with-llm pipeline against a FAKE scripted Responses API to verify the
 *                harness itself (no keys, no cost). Its numbers say nothing about any model.
 * Runs against TEST_DATABASE_URL only. Unmeasured metrics are reported as null — never estimated.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { loadDataset } from "./eval/dataset";
import { meterModel, type CallRecord } from "./eval/metering";
import { costUsd, percentile, type Pricing } from "./eval/metrics";
import { renderContract } from "./eval/documents";
import { evaluateAnswers, evaluateRetrieval, type AnswerRow, type RetrievalRow } from "./eval/answers";
import { evaluateRiskRun, type RiskRunRow } from "./eval/risk";
import { bySplit, summarizeAnswers, summarizeRetrieval, summarizeRisk } from "./eval/summary";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, def: string | null = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};

const datasetPath = option("dataset", "evals/datasets/contract-qa.v3.json")!;
const K = Number(option("k", "5"));
const RECALL_KS = (option("recall-ks", "1,3,5,8") ?? "").split(",").map(Number).filter((n) => n > 0);
const riskRepeats = Math.max(1, Number(option("risk-repeats", "1")));
const withLlm = flag("with-llm");
const selfTest = flag("self-test");
const withLlmMode = withLlm || selfTest;
const judgeSpec = option("judge") ?? (selfTest ? "openai:gpt-6-luna" : null); // "provider:model" – one FIXED judge for every compared run

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required (evaluation never runs on the primary database).");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.WORKER_IN_PROCESS = "false";
if (option("provider")) process.env.LLM_PROVIDER = option("provider")!;
if (option("model")) process.env.LLM_MODEL = option("model")!;
if (option("utility-model")) process.env.LLM_UTILITY_MODEL = option("utility-model")!;
if (selfTest) {
  process.env.LLM_PROVIDER = option("provider") ?? "openai";
  process.env.EMBEDDING_PROVIDER = "local-hash"; // the fake API serves Responses only; never call real embeddings in a self-test
  for (const key of ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"]) process.env[key] = "self-test-not-a-real-key";
}

/** Generic scripted replies for --self-test (category-agnostic; exercises every code path). */
function selfTestResponder(prompt: string, req: { structured: boolean; schemaName: string | null }): string {
  const firstSource = /<source id="(S\d+)"[^>]*>\n([\s\S]*?)\n<\/source>/.exec(prompt);
  const quote = firstSource ? firstSource[2].split(/(?<=[.;])\s/)[0].slice(0, 160) : "";
  if (!req.structured) return firstSource ? `According to the contract: "${quote}" [${firstSource[1]}].` : "The provision was not found.";
  if (prompt.includes("Identify the contract type")) return JSON.stringify({ contractType: "Agreement", parties: [], summary: "Self-test profile." });
  if (prompt.includes("Answer to grade")) return JSON.stringify({ claims: [{ claim: "self-test claim", supported: true }] });
  return JSON.stringify({
    clauseStatus: firstSource ? "PRESENT" : "NOT_IDENTIFIED",
    summary: "Self-test evaluation.",
    clauseEvidence: firstSource ? [{ sourceId: firstSource[1], quote }] : [],
    findings: firstSource
      ? [{ title: "Self-test finding", severityFactors: { direction: "ADVERSE", exposure: "MODERATE", marketPosition: "DEVIATES" }, severity: "MEDIUM", explanation: "x", basis: "EXPLICIT", evidence: [{ sourceId: firstSource[1], quote }], businessImplication: "x", reviewSuggestion: "x", confidence: "LOW" }]
      : [],
  });
}

async function main() {
  const dataset = loadDataset(datasetPath);
  const onlyContracts = option("contracts")?.split(",");
  const contracts = dataset.contracts.filter((c) => (!onlyContracts || onlyContracts.includes(c.id)) && (!option("split") || c.split === option("split")));
  const { getDb, closeDb } = await import("@/server/db/client");
  const { user, documents } = await import("@/server/db/schema");
  const { uploadDocument } = await import("@/server/documents/document-service");
  const { defaultProcessingDeps, processDocument } = await import("@/server/documents/processing");
  const { getEmbedder } = await import("@/server/ai/embeddings");
  const { getModel, isLlmConfigured, buildModelHandle, apiKeyVarFor } = await import("@/server/ai/models");
  const { getEnv } = await import("@/server/config/env");
  if (selfTest) {
    const { setProviderFetch } = await import("@/server/ai/models");
    const { createFakeResponsesApi } = await import("../tests/support/fake-responses-api");
    setProviderFetch(createFakeResponsesApi(selfTestResponder, "self-test").fetch);
    console.log("SELF-TEST MODE: scripted fake Responses API — these numbers do NOT measure any model.");
  }

  const db = getDb();
  const embedder = getEmbedder();
  if (withLlmMode && !isLlmConfigured()) throw new Error(`--with-llm requested but ${apiKeyVarFor(getEnv().LLM_PROVIDER)} is not set.`);
  let purpose = "";
  const setPurpose = (p: string) => (purpose = p);
  const metered = withLlmMode ? meterModel(getModel("primary"), () => purpose) : null;

  let judge: ReturnType<typeof buildModelHandle> | null = null;
  let judgeCalls: CallRecord[] = [];
  if (withLlmMode && judgeSpec) {
    const [provider, ...rest] = judgeSpec.split(":");
    const keyVar = apiKeyVarFor(provider as "openai");
    const key = process.env[keyVar];
    if (!key) throw new Error(`--judge ${judgeSpec} needs ${keyVar}.`);
    judge = buildModelHandle({ provider: provider as "openai", modelId: rest.join(":"), apiKey: key, effort: "medium", maxOutputTokens: 4096 });
    const judgeMeter = meterModel(judge, () => purpose); // judge calls are metered separately (purpose "judge:*")
    judge = judgeMeter.handle;
    judgeCalls = judgeMeter.calls;
  }

  const llmLabel = metered?.handle.label ?? null;
  console.log(`Dataset ${dataset.name}@${dataset.version} (${contracts.length} contracts) · embedder ${embedder.id} · k=${K}${llmLabel ? ` · LLM ${llmLabel}` : ""}${judge ? ` · judge ${judge.label}` : ""} · risk repeats ${riskRepeats}`);
  if (embedder.id.startsWith("local-hash")) console.log("NOTE: local-hash is a lexical baseline embedder, not a semantic model.");

  const ownerId = `eval-${Date.now()}`;
  await db.insert(user).values({ id: ownerId, name: "Evaluation", email: `${ownerId}@eval.invalid` });
  const retrievalRows: RetrievalRow[] = [];
  const answerRows: AnswerRow[] = [];
  const riskRows: RiskRunRow[] = [];
  let chunkTotal = 0;

  try {
    for (const contract of contracts) {
      const file = await renderContract(contract);
      const doc = await uploadDocument(ownerId, file);
      await processDocument(doc.id, ownerId, defaultProcessingDeps());
      const [{ chunkCount }] = await db.select({ chunkCount: documents.chunkCount }).from(documents).where(eq(documents.id, doc.id));
      chunkTotal += chunkCount;
      console.log(`· ${contract.id} (${contract.split}): ${chunkCount} chunks`);

      retrievalRows.push(...(await evaluateRetrieval(contract, doc.id, { ownerId, k: K, recallDepth: Math.max(...RECALL_KS) })));
      if (!metered) continue;
      if (!flag("skip-answers")) answerRows.push(...(await evaluateAnswers(contract, doc.id, { ownerId, model: metered.handle, judge, k: K, recallDepth: Math.max(...RECALL_KS), setPurpose })));
      if (!flag("skip-risk")) {
        for (let run = 1; run <= riskRepeats; run++) {
          riskRows.push(await evaluateRiskRun(contract, doc.id, run, { ownerId, model: metered.handle, calls: metered.calls, setPurpose }));
          console.log(`  risk run ${run}/${riskRepeats} done`);
        }
      }
    }
  } finally {
    await db.delete(user).where(eq(user.id, ownerId)); // cascades to all evaluation data
    await closeDb();
  }

  const calls: CallRecord[] = metered?.calls ?? [];
  const pricingPath = option("pricing", "evals/pricing.json")!;
  const pricing = (JSON.parse(readFileSync(pricingPath, "utf8")) as { models: Record<string, Pricing> }).models;
  const sumTokens = (xs: CallRecord[]) => xs.reduce((t, c) => ({ input: t.input + c.inputTokens, cachedInput: t.cachedInput + c.cachedInputTokens, output: t.output + c.outputTokens }), { input: 0, cachedInput: 0, output: 0 });
  const tokens = sumTokens(calls);
  const answerLatency = calls.filter((c) => c.purpose.startsWith("answer") && !c.error).map((c) => c.latencyMs);
  const riskLatency = calls.filter((c) => c.purpose === "risk" && !c.error).map((c) => c.latencyMs);

  const report = {
    schema: 3,
    dataset: `${dataset.name}@${dataset.version}`,
    label: selfTest ? `SELF-TEST (fake model, not an evaluation) ${llmLabel}` : option("label", llmLabel ?? "retrieval-only"),
    selfTest,
    ranAt: new Date().toISOString(),
    embedder: embedder.id,
    llm: llmLabel,
    judge: judge?.label ?? null,
    k: K,
    recallKs: RECALL_KS,
    riskRepeats,
    contracts: contracts.map((c) => ({ id: c.id, split: c.split, format: c.format, questions: c.questions.length })),
    chunks: chunkTotal,
    retrieval: bySplit(retrievalRows, (r) => summarizeRetrieval(r, RECALL_KS)),
    answers: answerRows.length ? bySplit(answerRows, summarizeAnswers) : null,
    risk: riskRows.length ? bySplit(riskRows, summarizeRisk) : null,
    usage: withLlmMode
      ? {
          calls: calls.length,
          failedCalls: calls.filter((c) => c.error).length,
          tokens,
          costUsd: costUsd(tokens, llmLabel ? pricing[llmLabel] : undefined),
          judgeCalls: judgeCalls.length,
          judgeCostUsd: judge ? costUsd(sumTokens(judgeCalls), pricing[judge.label]) : null,
          answerLatencyMs: { p50: percentile(answerLatency, 50), p95: percentile(answerLatency, 95) },
          riskCallLatencyMs: { p50: percentile(riskLatency, 50), p95: percentile(riskLatency, 95) },
        }
      : null,
    rows: { retrieval: retrievalRows, answers: answerRows, risk: riskRows },
    callErrors: [...calls, ...judgeCalls].filter((c) => c.error).map((c) => ({ purpose: c.purpose, error: c.error })),
  };

  mkdirSync("evals/results", { recursive: true });
  const safeLabel = String(report.label).replace(/[^a-z0-9.-]+/gi, "_");
  const out = path.join("evals/results", `${dataset.name}-v${dataset.version}-${safeLabel}-${report.ranAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  const a = report.answers?.all, r = report.risk?.all, ret = report.retrieval.all;
  console.table({
    ...Object.fromEntries(Object.entries(ret.recall).map(([k, v]) => [`recall${k}`, v])),
    MRR: ret.mrr,
    "full-evidence recall": ret.fullEvidenceRecall,
    "answer correctness": a?.correctness ?? null,
    "abstention accuracy": a?.abstentionAccuracy ?? null,
    "citation correctness": a?.citationCorrectness ?? null,
    "numeric grounding": a?.numericGrounding ?? null,
    faithfulness: a?.faithfulness ?? null,
    "clause recall": r?.clauseRecall ?? null,
    "severity agreement": r?.severityAgreement ?? null,
    "severity stability": r?.severityStability ?? null,
    "evidence coverage": r?.evidenceCoverage ?? null,
    "cost (USD)": report.usage?.costUsd ?? null,
  });
  console.log(`Report written to ${out}`);
}

main().catch((err: unknown) => {
  console.error("Evaluation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
