import { RISK_SEVERITIES, type RiskSeverity } from "@/lib/domain";

/**
 * Severity calibration.
 *
 * The model labels each finding with a severity AND with three factors that
 * drive severity in contract review practice:
 *   - direction:      does the provision disadvantage the reviewing party?
 *   - exposure:       how large is the practical consequence?
 *   - marketPosition: how far is it from customary terms for this contract type?
 *
 * Models are noticeably more consistent at judging these factors than at
 * picking a single label, and the label is the part that drifted in evaluation
 * (e.g. a mutual, customary clause rated HIGH; a clause that PROTECTS the
 * reviewing party rated MEDIUM). This module derives the range of severities
 * the factors allow and clamps the model's label into it. It never invents a
 * severity: inside the allowed range the model's own choice is kept.
 *
 * Pure and deterministic, so it is unit tested directly.
 */

export const SEVERITY_DIRECTIONS = ["ADVERSE", "BALANCED", "FAVOURABLE"] as const;
export const SEVERITY_EXPOSURES = ["SEVERE", "SIGNIFICANT", "MODERATE", "MINOR", "NONE"] as const;
export const MARKET_POSITIONS = ["STANDARD", "DEVIATES", "UNUSUAL"] as const;

export type SeverityDirection = (typeof SEVERITY_DIRECTIONS)[number];
export type SeverityExposure = (typeof SEVERITY_EXPOSURES)[number];
export type MarketPosition = (typeof MARKET_POSITIONS)[number];

export interface SeverityFactors {
  direction: SeverityDirection;
  exposure: SeverityExposure;
  marketPosition: MarketPosition;
}

/** Stored with each finding so reviewers can see why a severity was (or was not) changed. */
export interface SeverityRationale extends SeverityFactors {
  modelSeverity: RiskSeverity;
  adjusted: boolean;
  allowed: [RiskSeverity, RiskSeverity];
}

/** 0 = CRITICAL … 4 = INFORMATIONAL (index in RISK_SEVERITIES). */
const rank = (s: RiskSeverity) => RISK_SEVERITIES.indexOf(s);
const at = (r: number) => RISK_SEVERITIES[r];
const mildest = (...xs: RiskSeverity[]) => at(Math.max(...xs.map(rank)));

/** Highest severity each exposure level can justify. */
const EXPOSURE_CEILING: Record<SeverityExposure, RiskSeverity> = {
  SEVERE: "CRITICAL",
  SIGNIFICANT: "HIGH",
  MODERATE: "MEDIUM",
  MINOR: "LOW",
  NONE: "INFORMATIONAL",
};

/**
 * Allowed [most severe, mildest] range for a finding with these factors.
 *
 * Ceilings (a finding cannot be rated above):
 *  - its exposure level (table above);
 *  - LOW if the provision favours the reviewing party (a gap in a protection
 *    you receive is a negotiation point, not a material risk to you);
 *  - LOW if it is balanced and customary; MEDIUM if balanced but off-market;
 *  - MEDIUM if it is customary for this contract type, whatever the direction.
 * Floors (a finding cannot be rated below):
 *  - HIGH for adverse, severe exposure that departs from market terms;
 *  - MEDIUM for adverse, significant exposure on unusual terms.
 */
export function allowedSeverityRange(f: SeverityFactors): [RiskSeverity, RiskSeverity] {
  const ceilings: RiskSeverity[] = [EXPOSURE_CEILING[f.exposure]];
  if (f.direction === "FAVOURABLE") ceilings.push("LOW");
  if (f.direction === "BALANCED") ceilings.push(f.marketPosition === "STANDARD" ? "LOW" : "MEDIUM");
  if (f.marketPosition === "STANDARD") ceilings.push("MEDIUM");
  const ceiling = mildest(...ceilings);

  let floor: RiskSeverity = "INFORMATIONAL";
  if (f.direction === "ADVERSE" && f.exposure === "SEVERE" && f.marketPosition !== "STANDARD") floor = "HIGH";
  else if (f.direction === "ADVERSE" && f.exposure === "SIGNIFICANT" && f.marketPosition === "UNUSUAL") floor = "MEDIUM";

  // Floors only apply to adverse, non-standard findings, whose ceiling is never milder than the floor.
  return [ceiling, rank(floor) < rank(ceiling) ? ceiling : floor];
}

/** Clamps the model's severity into the range its own factors allow. */
export function calibrateSeverity(modelSeverity: RiskSeverity, factors: SeverityFactors): { severity: RiskSeverity; rationale: SeverityRationale } {
  const allowed = allowedSeverityRange(factors);
  const [ceiling, floor] = allowed;
  const r = rank(modelSeverity);
  const severity = r < rank(ceiling) ? ceiling : r > rank(floor) ? floor : modelSeverity;
  return { severity, rationale: { ...factors, modelSeverity, adjusted: severity !== modelSeverity, allowed } };
}
