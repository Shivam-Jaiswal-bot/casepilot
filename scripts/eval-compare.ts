/**
 * Side-by-side comparison of evaluation reports produced by `npm run eval -- --with-llm`.
 *   npm run eval:compare -- evals/results/<a>.json evals/results/<b>.json [--split all|dev|holdout]
 * Prints a Markdown table and writes it to evals/results/comparison-<timestamp>.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Num = number | null | undefined;
type Section = Record<string, unknown>;
type Report = {
  schema?: number;
  label: string;
  dataset: string;
  llm: string | null;
  judge: string | null;
  embedder: string;
  k: number;
  retrieval: Section & { all?: Section };
  answers: (Section & { all?: Section }) | null;
  risk: (Section & { all?: Section }) | null;
  usage: { calls: number; failedCalls: number; tokens: { input: number; output: number }; costUsd: number | null; answerLatencyMs: { p50: Num; p95: Num }; riskCallLatencyMs: { p50: Num; p95: Num } } | null;
};

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const splitArg = process.argv.includes("--split") ? process.argv[process.argv.indexOf("--split") + 1] : "all";
if (files.length < 2) {
  console.error("Usage: npm run eval:compare -- <report-a.json> <report-b.json> [...] [--split all|dev|holdout]");
  process.exit(1);
}
const reports = files.filter((f) => f !== splitArg).map((f) => JSON.parse(readFileSync(f, "utf8")) as Report);
if (new Set(reports.map((r) => r.dataset)).size > 1) console.warn("WARNING: reports use different datasets; comparison is not like-for-like.");
if (new Set(reports.map((r) => r.judge)).size > 1) console.warn("WARNING: reports use different judges; faithfulness is not comparable.");

/** Schema-3 reports nest metrics per split; older reports are flat (treated as "all"). */
const pick = (section: (Section & { all?: Section }) | null, key: string): unknown => {
  if (!section) return null;
  const scoped = (section[splitArg] ?? (splitArg === "all" ? section : null)) as Section | null;
  return scoped ? scoped[key] : null;
};
const fmt = (v: unknown) => (v === null || v === undefined ? "n/a" : typeof v === "object" ? JSON.stringify(v) : String(v));
const rows: [string, (r: Report) => unknown][] = [
  ["Model", (r) => r.llm],
  ["Retrieval recall@1/3/5/8", (r) => pick(r.retrieval, "recall") ?? pick(r.retrieval, "recallAtK")],
  ["Retrieval MRR", (r) => pick(r.retrieval, "mrr")],
  ["Full-evidence recall (conflict/x-ref)", (r) => pick(r.retrieval, "fullEvidenceRecall")],
  ["Answer correctness", (r) => pick(r.answers, "correctness")],
  ["Correctness by question kind", (r) => pick(r.answers, "byKind")],
  ["Abstention accuracy (unanswerable)", (r) => pick(r.answers, "abstentionAccuracy")],
  ["False abstention rate (answerable)", (r) => pick(r.answers, "falseAbstentionRate")],
  ["Citation correctness", (r) => pick(r.answers, "citationCorrectness")],
  ["Citation precision", (r) => pick(r.answers, "citationPrecision")],
  ["Citation validity", (r) => pick(r.answers, "citationValidity")],
  ["Citation coverage", (r) => pick(r.answers, "citationCoverage")],
  ["Unsupported page refs (count)", (r) => pick(r.answers, "unsupportedPageRefs")],
  ["Numeric grounding", (r) => pick(r.answers, "numericGrounding")],
  ["Faithfulness (judged)", (r) => pick(r.answers, "faithfulness")],
  ["Clause identification recall", (r) => pick(r.risk, "clauseRecall")],
  ["Clause identification precision", (r) => pick(r.risk, "clausePrecision")],
  ["Severity agreement (band)", (r) => pick(r.risk, "severityAgreement")],
  ["Mean severity distance", (r) => pick(r.risk, "meanSeverityDistance")],
  ["Over- / under-severity rate", (r) => `${fmt(pick(r.risk, "overSeverityRate"))} / ${fmt(pick(r.risk, "underSeverityRate"))}`],
  ["Severity stability (repeats)", (r) => pick(r.risk, "severityStability")],
  ["Risk evidence coverage", (r) => pick(r.risk, "evidenceCoverage")],
  ["Finding verification rate", (r) => pick(r.risk, "findingVerificationRate")],
  ["Severity calibration adjustments", (r) => pick(r.risk, "severityAdjustments")],
  ["Structured output validity", (r) => pick(r.risk, "structuredOutputValidity")],
  ["LLM calls (failed)", (r) => (r.usage ? `${r.usage.calls} (${r.usage.failedCalls})` : null)],
  ["Tokens in / out", (r) => (r.usage ? `${r.usage.tokens.input} / ${r.usage.tokens.output}` : null)],
  ["Cost (USD, whole run, excl. judge)", (r) => r.usage?.costUsd],
  ["Answer latency p50 / p95 (ms)", (r) => (r.usage ? `${fmt(r.usage.answerLatencyMs.p50)} / ${fmt(r.usage.answerLatencyMs.p95)}` : null)],
  ["Risk call latency p50 / p95 (ms)", (r) => (r.usage ? `${fmt(r.usage.riskCallLatencyMs.p50)} / ${fmt(r.usage.riskCallLatencyMs.p95)}` : null)],
];

const header = `| Metric | ${reports.map((r) => r.label).join(" | ")} |\n|---|${reports.map(() => "---").join("|")}|`;
const body = rows.map(([name, get]) => `| ${name} | ${reports.map((r) => fmt(get(r))).join(" | ")} |`).join("\n");
const meta = `Split: ${splitArg} · Dataset: ${reports[0].dataset} · Embedder: ${reports[0].embedder} · Judge: ${reports[0].judge ?? "none (faithfulness not measured)"}`;
const md = `${meta}\n\n${header}\n${body}\n`;
console.log(md);
mkdirSync("evals/results", { recursive: true });
const out = `evals/results/comparison-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
writeFileSync(out, md);
console.log(`Written to ${out}`);
