/**
 * Re-scores a stored evaluation report with the CURRENT deterministic metrics,
 * without calling any model. Use it after fixing a metric so earlier runs are
 * scored by exactly the same code as new ones.
 *
 *   npm run eval:rescore -- evals/results/<report>.json [--dataset evals/datasets/contract-qa.v3.json]
 *
 * Recomputed: answer correctness/abstention (keyword + decline detection) and the risk
 * aggregates from stored per-run rows (e.g. severity stability). Judge scores and per-run
 * risk observations are copied unchanged. Truncated stored answers (1500 chars) are flagged.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { AnswerRow } from "./eval/answers";
import type { RiskRunRow } from "./eval/risk";
import { loadDataset } from "./eval/dataset";
import { isAnswerCorrect } from "./eval/metrics";
import { bySplit, summarizeAnswers, summarizeRisk } from "./eval/summary";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json") && !a.includes("datasets/"));
const datasetPath = args.includes("--dataset") ? args[args.indexOf("--dataset") + 1] : "evals/datasets/contract-qa.v3.json";
if (!file) {
  console.error("Usage: npm run eval:rescore -- <report.json> [--dataset <path>]");
  process.exit(1);
}

const report = JSON.parse(readFileSync(file, "utf8")) as { schema?: number; rows: { answers: AnswerRow[]; risk: RiskRunRow[] }; answers: unknown; risk: unknown; notes?: string[] };
if (report.schema !== 3) throw new Error("Only schema-3 reports (with stored answer rows) can be re-scored.");
const questions = new Map(loadDataset(datasetPath).contracts.flatMap((c) => c.questions.map((q) => [`${c.id}/${q.id}`, q] as const)));

let changed = 0;
let truncated = 0;
const rows = report.rows.answers.map((row) => {
  const q = questions.get(`${row.contract}/${row.id}`);
  if (!q) throw new Error(`Question ${row.contract}/${row.id} is not in ${datasetPath}`);
  if (row.answer.length >= 1500) truncated++;
  const correct = isAnswerCorrect(q, row.answer, row.abstained);
  if (correct !== row.correct) changed++;
  return { ...row, correct };
});

const out = file.replace(/\.json$/, "-rescored.json");
const previous = report.answers;
writeFileSync(
  out,
  `${JSON.stringify(
    {
      ...report,
      label: `${(report as unknown as { label: string }).label} (rescored)`,
      answers: bySplit(rows, summarizeAnswers),
      answersBeforeRescore: previous,
      risk: report.rows.risk.length ? bySplit(report.rows.risk, summarizeRisk) : report.risk,
      riskBeforeRescore: report.risk,
      rows: { ...report.rows, answers: rows },
      notes: [...(report.notes ?? []), `Re-scored ${new Date().toISOString()} with current metrics: ${changed} answer verdict(s) changed; ${truncated} stored answer(s) were truncated at 1500 chars.`],
    },
    null,
    2,
  )}\n`,
);
console.log(`${changed} verdict(s) changed, ${truncated} truncated answer(s). Written to ${out}`);
