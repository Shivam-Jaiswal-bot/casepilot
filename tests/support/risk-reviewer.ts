/** Scripted mock reviewer shared by risk tests. */
/** Finds the source id whose text contains `needle` in a rendered <sources> block. */
function sourceIdContaining(prompt: string, needle: string): string | null {
  for (const m of prompt.matchAll(/<source id="(S\d+)"[^>]*>([\s\S]*?)<\/source>/g)) if (m[2].includes(needle)) return m[1];
  return null;
}

const notIdentified = JSON.stringify({ clauseStatus: "NOT_IDENTIFIED", summary: "Nothing found.", clauseEvidence: [], findings: [] });

/**
 * Scripted reviewer: one real finding for termination, one fabricated finding
 * for indemnification (must be discarded), a present-but-balanced governing
 * law clause, and NOT_IDENTIFIED for everything else.
 */
export function reviewer(prompt: string): string {
  if (prompt.includes("Identify the contract type")) {
    return JSON.stringify({ contractType: "Master Services Agreement", parties: ["Acme Analytics Ltd.", "Northwind Retail Inc."], summary: "Services agreement." });
  }
  const category = prompt.match(/Clause category under review: (.+)/)?.[1];
  if (category === "Termination") {
    const sid = sourceIdContaining(prompt, "for any reason on ten (10) days");
    if (!sid) return notIdentified;
    return JSON.stringify({
      clauseStatus: "PRESENT",
      summary: "Asymmetric termination rights.",
      clauseEvidence: [{ sourceId: sid, quote: "Either party may terminate this Agreement if the other party commits a material breach" }],
      findings: [
        {
          title: "Provider may terminate for convenience on 10 days' notice",
          severityFactors: { direction: "ADVERSE", exposure: "SIGNIFICANT", marketPosition: "DEVIATES" },
          severity: "HIGH",
          explanation: "The Provider can exit on 10 days while the Customer needs 180.",
          basis: "EXPLICIT",
          evidence: [{ sourceId: sid, quote: "The Provider may terminate this Agreement for any reason on ten (10) days written notice" }],
          businessImplication: "Sudden loss of service.",
          reviewSuggestion: "Negotiate mutual notice periods.",
          confidence: "HIGH",
        },
      ],
    });
  }
  if (category === "Indemnification") {
    return JSON.stringify({
      clauseStatus: "PRESENT",
      summary: "Broad indemnity.",
      clauseEvidence: [{ sourceId: "S1", quote: "The Customer shall indemnify the Provider against all losses" }],
      findings: [
        {
          title: "Unlimited customer indemnity",
          severityFactors: { direction: "ADVERSE", exposure: "SEVERE", marketPosition: "UNUSUAL" },
          severity: "CRITICAL",
          explanation: "Fabricated.",
          basis: "EXPLICIT",
          evidence: [{ sourceId: "S1", quote: "The Customer shall indemnify the Provider against all losses without limit" }],
          businessImplication: "x",
          reviewSuggestion: "x",
          confidence: "HIGH",
        },
      ],
    });
  }
  if (category === "Governing law") {
    const sid = sourceIdContaining(prompt, "governed by the laws of the State of Delaware");
    return JSON.stringify({
      clauseStatus: "PRESENT",
      summary: "Delaware law governs.",
      clauseEvidence: sid ? [{ sourceId: sid, quote: "This Agreement is governed by the laws of the State of Delaware" }] : [],
      findings: [],
    });
  }
  return notIdentified;
}
