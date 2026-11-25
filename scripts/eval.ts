/**
 * CasePilot evaluation harness.
 *
 *   npm run eval                       # retrieval metrics only (no LLM calls)
 *   npm run eval -- --with-llm         # + answer, citation, abstention, faithfulness and risk metrics
 *   npm run eval -- --dataset evals/datasets/contract-qa.v1.json --k 5
 *
 * Runs against TEST_DATABASE_URL so evaluation never touches development data.
 * Metrics that were not measured are reported as null — never estimated.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { generateText, Output } from "ai";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const datasetPath = option("dataset", "evals/datasets/contract-qa.v1.json");
const K = Number(option("k", "5"));
const withLlm = flag("with-llm");

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required (evaluation never runs on the primary database).");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.WORKER_IN_PROCESS = "false";

const datasetSchema = z.object({
  name: z.string(),
  version: z.string(),
  contract: z.object({ title: z.string(), pages: z.array(z.array(z.string())) }),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      answerable: z.boolean(),
      expectedPages: z.array(z.number()).optional(),
      expectedPhrases: z.array(z.string()).optional(),
    }),
  ),
  riskExpectations: z.object({ identified: z.array(z.string()), notIdentified: z.array(z.string()) }),
});
type Question = z.infer<typeof datasetSchema>["questions"][number];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null);

/** A retrieved chunk is relevant when it covers an expected page AND contains an expected phrase. */
function isRelevant(chunk: { content: string; pageStart: number | null; pageEnd: number | null }, q: Question): boolean {
  const pageOk = !q.expectedPages?.length || q.expectedPages.some((p) => chunk.pageStart != null && p >= chunk.pageStart && p <= (chunk.pageEnd ?? chunk.pageStart));
  const phraseOk = !q.expectedPhrases?.length || q.expectedPhrases.some((ph) => norm(chunk.content).includes(norm(ph)));
  return pageOk && phraseOk;
}

async function buildPdf(pages: string[][]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const paragraphs of pages) {
    const page = pdf.addPage([612, 792]);
    let y = 740;
    for (const para of paragraphs) {
      let line = "";
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, 10) > 500 && line) {
          page.drawText(line, { x: 56, y, size: 10, font });
          y -= 14;
          line = word;
        } else line = next;
      }
      if (line) page.drawText(line, { x: 56, y, size: 10, font });
      y -= 24;
    }
  }
  return Buffer.from(await pdf.save());
}

const judgeSchema = z.object({
  verdict: z.enum(["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED"]),
  unsupportedClaims: z.array(z.string()),
});

async function main() {
  const dataset = datasetSchema.parse(JSON.parse(readFileSync(datasetPath, "utf8")));
  const { getDb, closeDb } = await import("@/server/db/client");
  const { user } = await import("@/server/db/schema");
  const { uploadDocument } = await import("@/server/documents/document-service");
  const { defaultProcessingDeps, processDocument } = await import("@/server/documents/processing");
  const { retrieve } = await import("@/server/retrieval/retrieval-service");
  const { getEmbedder } = await import("@/server/ai/embeddings");
  const { getModel, isLlmConfigured } = await import("@/server/ai/models");
  const { answerQuestion } = await import("@/server/rag/rag-service");
  const { renderSources } = await import("@/server/rag/prompts");

  const db = getDb();
  const ownerId = `eval-${Date.now()}`;
  const embedder = getEmbedder();
  console.log(`Dataset ${dataset.name}@${dataset.version} · embedder ${embedder.id} · k=${K}${withLlm ? " · with LLM" : ""}`);
  if (embedder.id.startsWith("local-hash")) console.log("NOTE: local-hash is a lexical baseline embedder, not a semantic model.");

  await db.insert(user).values({ id: ownerId, name: "Evaluation", email: `${ownerId}@eval.invalid` });
  try {
    const doc = await uploadDocument(ownerId, { filename: `${dataset.contract.title}.pdf`, data: await buildPdf(dataset.contract.pages) });
    await processDocument(doc.id, ownerId, defaultProcessingDeps());

    // ---------------- Retrieval ----------------
    const answerable = dataset.questions.filter((q) => q.answerable);
    const retrievalRows = [];
    for (const q of answerable) {
      const { chunks } = await retrieve({ ownerId, queries: [q.question], documentIds: [doc.id], topK: K });
      const firstRelevant = chunks.findIndex((c) => isRelevant(c, q));
      retrievalRows.push({ id: q.id, hit: firstRelevant >= 0, rank: firstRelevant >= 0 ? firstRelevant + 1 : null, retrieved: chunks.length });
    }
    const recallAtK = mean(retrievalRows.map((r) => (r.hit ? 1 : 0)));
    const mrr = mean(retrievalRows.map((r) => (r.rank ? 1 / r.rank : 0)));
    const unanswerable = dataset.questions.filter((q) => !q.answerable);
    const emptyContextRate = mean(
      await Promise.all(unanswerable.map(async (q) => ((await retrieve({ ownerId, queries: [q.question], documentIds: [doc.id], topK: K })).chunks.length === 0 ? 1 : 0))),
    );

    // ---------------- Generation (optional) ----------------
    const llm = {
      measured: false,
      citationCoverage: null as number | null,
      citationValidity: null as number | null,
      citationCorrectness: null as number | null,
      abstentionAccuracy: null as number | null,
      faithfulness: null as number | null,
      unsupportedPageRefs: null as number | null,
      riskCategoryRecall: null as number | null,
      riskFalseIdentifications: null as string[] | null,
      riskFindingEvidenceCoverage: null as number | null,
    };
    const answerRows: Record<string, unknown>[] = [];
    if (withLlm) {
      if (!isLlmConfigured()) throw new Error("--with-llm requested but no LLM API key is configured.");
      llm.measured = true;
      const model = getModel("primary");
      const coverage: number[] = [];
      const validity: number[] = [];
      const correctness: number[] = [];
      const abstention: number[] = [];
      const faithful: number[] = [];
      let badPages = 0;
      for (const q of dataset.questions) {
        const { text, validation, prepared } = await answerQuestion({ ownerId, question: q.question, documentIds: [doc.id] }, { model, topK: K });
        const markers = validation.citations.length + validation.invalidMarkers.length;
        badPages += validation.unsupportedPageRefs.length;
        if (q.answerable) {
          coverage.push(validation.citationCoverage);
          validity.push(markers ? validation.citations.length / markers : 0);
          correctness.push(validation.citations.some((c) => isRelevant({ content: prepared.sources.find((s) => s.chunkId === c.chunkId)?.content ?? "", pageStart: c.pageStart, pageEnd: c.pageEnd }, q)) ? 1 : 0);
          if (prepared.sources.length) {
            const { output } = await generateText({
              model: model.model,
              providerOptions: model.providerOptions,
              instructions: "You grade whether an answer is fully supported by the provided sources. A claim is supported only if the sources state it. Ignore citation formatting.",
              prompt: `${renderSources(prepared.sources)}\n\nAnswer to grade:\n${text}`,
              output: Output.object({ schema: judgeSchema }),
            });
            faithful.push(output.verdict === "SUPPORTED" ? 1 : output.verdict === "PARTIALLY_SUPPORTED" ? 0.5 : 0);
          }
        } else {
          const declined = validation.abstained || /not (found|identified|addressed|contain)|no (provision|clause|mention)|does not (include|contain|address)|couldn't find|could not find/i.test(text);
          abstention.push(declined ? 1 : 0);
        }
        answerRows.push({ id: q.id, abstained: validation.abstained, citations: validation.citations.length, invalidMarkers: validation.invalidMarkers, coverage: validation.citationCoverage });
      }
      Object.assign(llm, {
        citationCoverage: mean(coverage),
        citationValidity: mean(validity),
        citationCorrectness: mean(correctness),
        abstentionAccuracy: mean(abstention),
        faithfulness: mean(faithful),
        unsupportedPageRefs: badPages,
      });

      const { startRiskAnalysis, runRiskAnalysis, getAnalysis, defaultRiskDeps } = await import("@/server/risk/risk-service");
      const { processingJobs } = await import("@/server/db/schema");
      const analysis = await startRiskAnalysis(ownerId, doc.id, "We are the Customer (Brightline Logistics Ltd.)");
      await db.delete(processingJobs).where(eq(processingJobs.analysisId, analysis.id)); // run inline, not via the queue
      await runRiskAnalysis(analysis.id, ownerId, defaultRiskDeps());
      const result = await getAnalysis(ownerId, analysis.id);
      const identified = new Set(result.analysis.categoryCoverage.filter((c) => c.outcome === "IDENTIFIED").map((c) => c.category as string));
      llm.riskCategoryRecall = mean(dataset.riskExpectations.identified.map((c) => (identified.has(c) ? 1 : 0)));
      llm.riskFalseIdentifications = dataset.riskExpectations.notIdentified.filter((c) => identified.has(c));
      llm.riskFindingEvidenceCoverage = mean(result.findings.map((f) => (f.evidence.length > 0 ? 1 : 0)));
    }

    const report = {
      dataset: `${dataset.name}@${dataset.version}`,
      ranAt: new Date().toISOString(),
      embedder: embedder.id,
      llm: withLlm ? getModel("primary").label : null,
      k: K,
      document: { chunks: (await db.select().from((await import("@/server/db/schema")).documents).where(eq((await import("@/server/db/schema")).documents.id, doc.id)))[0]?.chunkCount },
      retrieval: { recallAtK, mrr, answerableQuestions: answerable.length, emptyContextRateOnUnanswerable: emptyContextRate },
      generation: llm,
      perQuestion: { retrieval: retrievalRows, answers: answerRows },
    };

    mkdirSync("evals/results", { recursive: true });
    const out = path.join("evals/results", `${dataset.name}-v${dataset.version}-${report.ranAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.table({
      [`recall@${K}`]: recallAtK,
      MRR: mrr,
      "empty context (unanswerable)": emptyContextRate,
      "citation coverage": llm.citationCoverage,
      "citation validity": llm.citationValidity,
      "citation correctness": llm.citationCorrectness,
      "abstention accuracy": llm.abstentionAccuracy,
      "faithfulness (LLM-judged)": llm.faithfulness,
      "risk category recall": llm.riskCategoryRecall,
      "risk evidence coverage": llm.riskFindingEvidenceCoverage,
    });
    const misses = retrievalRows.filter((r) => !r.hit).map((r) => r.id);
    if (misses.length) console.log(`Retrieval misses: ${misses.join(", ")}`);
    console.log(`Report written to ${out}`);
  } finally {
    await db.delete(user).where(eq(user.id, ownerId)); // cascades to all eval data
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error("Evaluation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
