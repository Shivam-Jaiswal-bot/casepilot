import { readFileSync } from "node:fs";
import { z } from "zod";
import { CLAUSE_CATEGORIES, RISK_SEVERITIES } from "@/lib/domain";

/** Evaluation dataset schema (v2/v3). v1 files (single contract) are normalised to the same shape. v3 adds optional fields only. */

const severity = z.enum(RISK_SEVERITIES);
const category = z.enum(CLAUSE_CATEGORIES);

export const QUESTION_KINDS = ["lookup", "cross-reference", "conflict", "ambiguous", "unanswerable"] as const;

const questionSchema = z.object({
  id: z.string(),
  question: z.string(),
  answerable: z.boolean(),
  /** What the question tests; used to break metrics down. */
  kind: z.enum(QUESTION_KINDS).optional(),
  expectedPages: z.array(z.number()).optional(),
  /** A retrieved chunk is relevant if it contains ANY of these (and covers an expected page, if given). */
  expectedPhrases: z.array(z.string()).optional(),
  /** Conflict / cross-reference questions: EVERY phrase must appear somewhere in the top-K for full evidence recall. */
  expectedPhrasesAll: z.array(z.string()).optional(),
  /** Case-insensitive any-of substrings an answer must contain to count as correct (answerable only). */
  answerKeys: z.array(z.string()).optional(),
  /** Stricter form: every group must match (any key within a group). Takes precedence over answerKeys. */
  answerKeyGroups: z.array(z.array(z.string()).min(1)).optional(),
});

const contractSchema = z
  .object({
    id: z.string(),
    /** dev: labels seen while tuning prompts; holdout: labels written before any model ran on the contract. */
    split: z.enum(["dev", "holdout"]).default("dev"),
    format: z.enum(["pdf", "docx"]),
    title: z.string(),
    perspective: z.string().nullable().default(null),
    pages: z.array(z.array(z.string())).optional(),
    sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()) })).optional(),
    questions: z.array(questionSchema),
    riskExpectations: z.object({
      identified: z.array(category),
      notIdentified: z.array(category),
      severityBands: z.record(z.string(), z.tuple([severity, severity])).default({}),
      /** Any-of phrases a verified risk quote for the category should contain (evidence coverage). */
      evidencePhrases: z.record(z.string(), z.array(z.string()).min(1)).default({}),
    }),
  })
  .refine((c) => (c.format === "pdf" ? Boolean(c.pages) : Boolean(c.sections)), "pdf contracts need pages, docx contracts need sections");

const v2Schema = z.object({ name: z.string(), version: z.string(), contracts: z.array(contractSchema).min(1) });

export type EvalQuestion = z.infer<typeof questionSchema>;
export type EvalContract = z.infer<typeof contractSchema>;
export type EvalDataset = z.infer<typeof v2Schema>;

export function loadDataset(path: string): EvalDataset {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (Array.isArray(raw.contracts)) return v2Schema.parse(raw);
  // v1: { contract: { title, pages }, questions, riskExpectations }
  const v1 = raw as { name: string; version: string; contract: { title: string; pages: string[][] }; questions: unknown; riskExpectations: unknown };
  return v2Schema.parse({
    name: v1.name,
    version: v1.version,
    contracts: [{ id: "contract-1", format: "pdf", title: v1.contract.title, pages: v1.contract.pages, questions: v1.questions, riskExpectations: v1.riskExpectations }],
  });
}
