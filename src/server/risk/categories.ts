import type { ClauseCategory } from "@/lib/domain";

/**
 * Per-category review playbook: retrieval queries (multiple phrasings improve
 * recall across drafting styles) and what a reviewer should look for.
 */
export interface CategoryPlaybook {
  queries: string[];
  reviewFocus: string;
}

export const CATEGORY_PLAYBOOK: Record<ClauseCategory, CategoryPlaybook> = {
  TERMINATION: {
    queries: [
      "termination of this agreement notice period terminate for convenience",
      "terminate for cause material breach cure period insolvency",
      "effect of termination obligations surviving termination",
    ],
    reviewFocus:
      "Who may terminate and on what grounds; termination for convenience; notice and cure periods; asymmetry between the parties; consequences of termination (fees, refunds, transition, survival).",
  },
  INDEMNIFICATION: {
    queries: [
      "indemnify defend and hold harmless claims losses",
      "indemnification procedure third party claims infringement indemnity",
    ],
    reviewFocus:
      "Scope of each party's indemnities (one-sided vs mutual), covered claims (IP infringement, negligence, breach), caps or exclusions applying to indemnities, defence and settlement control.",
  },
  LIMITATION_OF_LIABILITY: {
    queries: [
      "limitation of liability aggregate liability shall not exceed fees paid",
      "consequential indirect incidental special damages lost profits exclusion",
      "exceptions to limitation of liability gross negligence wilful misconduct",
    ],
    reviewFocus:
      "Liability caps (amount, whether mutual), exclusion of indirect/consequential damages, carve-outs from the cap (confidentiality, indemnities, data breach, gross negligence), uncapped exposure.",
  },
  CONFIDENTIALITY: {
    queries: [
      "confidential information non-disclosure obligations of receiving party",
      "confidentiality exceptions compelled disclosure duration return or destroy",
    ],
    reviewFocus:
      "Definition breadth, mutuality, permitted disclosures, duration of obligations after termination, return/destruction, remedies such as injunctive relief.",
  },
  INTELLECTUAL_PROPERTY: {
    queries: [
      "intellectual property rights ownership work product deliverables",
      "license grant assignment of intellectual property pre-existing materials",
    ],
    reviewFocus:
      "Ownership of deliverables and improvements, licences granted (scope, exclusivity, duration), background IP, assignment of rights, restrictions on use.",
  },
  DATA_PROTECTION: {
    queries: [
      "personal data protection privacy processing GDPR data processing agreement",
      "security breach notification data security measures subprocessors",
    ],
    reviewFocus:
      "Roles (controller/processor), compliance obligations, security standards, breach notification timelines, sub-processors, cross-border transfers, data deletion.",
  },
  PAYMENT: {
    queries: [
      "fees payment terms invoices due within days",
      "late payment interest price increase expenses taxes",
    ],
    reviewFocus:
      "Payment amounts and timing, late-payment interest or penalties, unilateral price increases, minimum commitments, non-refundable fees, set-off, unusual or open-ended charges.",
  },
  AUTO_RENEWAL: {
    queries: [
      "term renewal automatically renew successive periods unless notice of non-renewal",
      "initial term renewal term expiration",
    ],
    reviewFocus:
      "Automatic renewal mechanics, length of renewal terms, non-renewal notice windows (short windows are a common trap), price changes on renewal.",
  },
  GOVERNING_LAW: {
    queries: ["governing law laws of the state jurisdiction venue courts"],
    reviewFocus: "Which law governs, exclusive jurisdiction or venue, whether the choice is unusual or inconvenient for a party.",
  },
  DISPUTE_RESOLUTION: {
    queries: [
      "dispute resolution arbitration mediation escalation",
      "waiver of jury trial class action waiver injunctive relief",
    ],
    reviewFocus:
      "Escalation/mediation steps, binding arbitration (seat, rules, costs), jury or class-action waivers, carve-outs for injunctive relief, limitation periods for claims.",
  },
  ASSIGNMENT: {
    queries: ["assignment may not assign or transfer without prior written consent change of control"],
    reviewFocus:
      "Consent requirements, asymmetry (one party may assign freely), change-of-control provisions, assignment to affiliates or acquirers, subcontracting.",
  },
  WARRANTIES: {
    queries: [
      "representations and warranties warrants that services performed",
      "disclaimer of warranties as is merchantability fitness for a particular purpose",
    ],
    reviewFocus:
      "Scope and duration of warranties, warranty remedies, broad disclaimers, representations about authority and compliance, one-sidedness.",
  },
  NON_COMPETE_EXCLUSIVITY: {
    queries: [
      "non-compete shall not compete exclusivity exclusive provider",
      "non-solicitation of employees customers restrictive covenant",
    ],
    reviewFocus:
      "Exclusivity obligations, non-compete and non-solicitation scope (activities, geography, duration), most-favoured-customer terms, minimum purchase requirements.",
  },
  FORCE_MAJEURE: {
    queries: ["force majeure events beyond reasonable control acts of god pandemic delay"],
    reviewFocus:
      "Definition of events, whether payment obligations are excused, notice and mitigation duties, termination rights after prolonged force majeure.",
  },
  BREACH_REMEDIES: {
    queries: [
      "breach remedies cure period notice of breach",
      "liquidated damages service credits specific performance remedies cumulative",
    ],
    reviewFocus:
      "Cure periods, liquidated damages or service credits (and whether exclusive), suspension rights, specific performance, whether remedies are cumulative or sole and exclusive.",
  },
};
