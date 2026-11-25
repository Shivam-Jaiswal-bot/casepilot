import { z } from "zod";
import { ASSESSMENT_BASES, CONFIDENCE_LEVELS, RISK_SEVERITIES } from "@/lib/domain";

/**
 * Structured-output schemas for the risk engine.
 *
 * Constraints such as min/max array lengths are enforced in code after parsing
 * rather than in the schema: provider-native structured outputs support only a
 * subset of JSON Schema, and every property is required (nullable instead of
 * optional) for the same reason.
 */

export const contractProfileSchema = z.object({
  contractType: z.string().nullable().describe("e.g. 'Master Services Agreement'; null if unclear"),
  parties: z.array(z.string()).describe("Party names exactly as written in the contract"),
  summary: z.string().describe("Two or three sentence neutral summary of what the contract covers"),
});

export const evidenceRefSchema = z.object({
  sourceId: z.string().describe("Id of the source excerpt, e.g. 'S2'"),
  quote: z.string().describe("Short verbatim quotation copied exactly from that source (max ~60 words)"),
});

export const findingSchema = z.object({
  title: z.string().describe("Concise risk title, e.g. 'Vendor may terminate for convenience on 10 days notice'"),
  severity: z.enum(RISK_SEVERITIES),
  explanation: z.string().describe("Why this provision was flagged, referring to its actual wording"),
  basis: z.enum(ASSESSMENT_BASES).describe("EXPLICIT if the risk is stated in the text; INTERPRETATION if it follows from reading the text"),
  evidence: z.array(evidenceRefSchema),
  businessImplication: z.string().describe("Practical consequence for the reviewing party"),
  reviewSuggestion: z.string().describe("Concrete point for a lawyer to review or negotiate"),
  confidence: z.enum(CONFIDENCE_LEVELS),
});

export const categoryEvaluationSchema = z.object({
  clauseStatus: z
    .enum(["PRESENT", "NOT_IDENTIFIED"])
    .describe("PRESENT if the sources contain provisions of this category; NOT_IDENTIFIED otherwise"),
  summary: z.string().describe("One or two sentences summarising what the sources say about this category, or that nothing was found"),
  clauseEvidence: z
    .array(evidenceRefSchema)
    .describe("Verbatim quotes locating the provision(s) of this category. Required when PRESENT; empty when NOT_IDENTIFIED"),
  findings: z.array(findingSchema),
});

export type ContractProfileOutput = z.infer<typeof contractProfileSchema>;
export type CategoryEvaluation = z.infer<typeof categoryEvaluationSchema>;
export type FindingOutput = z.infer<typeof findingSchema>;

export const MAX_FINDINGS_PER_CATEGORY = 5;
export const MAX_EVIDENCE_PER_FINDING = 3;
