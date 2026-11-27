import { describe, expect, it } from "vitest";
import { allowedSeverityRange, calibrateSeverity, type SeverityFactors } from "@/server/risk/severity-calibration";

const f = (direction: SeverityFactors["direction"], exposure: SeverityFactors["exposure"], marketPosition: SeverityFactors["marketPosition"]): SeverityFactors => ({
  direction,
  exposure,
  marketPosition,
});

describe("allowedSeverityRange", () => {
  it("lets adverse, severe, off-market terms be HIGH or CRITICAL only (e.g. uncapped one-way indemnity)", () => {
    expect(allowedSeverityRange(f("ADVERSE", "SEVERE", "UNUSUAL"))).toEqual(["CRITICAL", "HIGH"]);
    expect(allowedSeverityRange(f("ADVERSE", "SEVERE", "DEVIATES"))).toEqual(["CRITICAL", "HIGH"]);
  });

  it("caps customary terms at MEDIUM even when adverse and severe", () => {
    expect(allowedSeverityRange(f("ADVERSE", "SEVERE", "STANDARD"))).toEqual(["MEDIUM", "INFORMATIONAL"]);
  });

  it("caps provisions that favour the reviewing party at LOW (e.g. a supplier IP indemnity reviewed for the buyer)", () => {
    expect(allowedSeverityRange(f("FAVOURABLE", "SIGNIFICANT", "DEVIATES"))).toEqual(["LOW", "INFORMATIONAL"]);
  });

  it("caps balanced terms at LOW when customary and MEDIUM when off-market (e.g. mutual renewal, mutual force majeure)", () => {
    expect(allowedSeverityRange(f("BALANCED", "SIGNIFICANT", "STANDARD"))).toEqual(["LOW", "INFORMATIONAL"]);
    expect(allowedSeverityRange(f("BALANCED", "SIGNIFICANT", "DEVIATES"))).toEqual(["MEDIUM", "INFORMATIONAL"]);
  });

  it("follows exposure as the ceiling", () => {
    expect(allowedSeverityRange(f("ADVERSE", "MINOR", "UNUSUAL"))[0]).toBe("LOW");
    expect(allowedSeverityRange(f("ADVERSE", "NONE", "UNUSUAL"))).toEqual(["INFORMATIONAL", "INFORMATIONAL"]);
  });

  it("sets a MEDIUM floor only for adverse, significant, unusual terms", () => {
    expect(allowedSeverityRange(f("ADVERSE", "SIGNIFICANT", "UNUSUAL"))).toEqual(["HIGH", "MEDIUM"]);
    expect(allowedSeverityRange(f("ADVERSE", "SIGNIFICANT", "DEVIATES"))).toEqual(["HIGH", "INFORMATIONAL"]);
  });

  it("always returns a non-empty range for every factor combination", () => {
    const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"];
    for (const d of ["ADVERSE", "BALANCED", "FAVOURABLE"] as const)
      for (const e of ["SEVERE", "SIGNIFICANT", "MODERATE", "MINOR", "NONE"] as const)
        for (const m of ["STANDARD", "DEVIATES", "UNUSUAL"] as const) {
          const [ceiling, floor] = allowedSeverityRange(f(d, e, m));
          expect(order.indexOf(ceiling)).toBeLessThanOrEqual(order.indexOf(floor));
        }
  });
});

describe("calibrateSeverity", () => {
  it("keeps the model's severity when it is inside the allowed range", () => {
    const r = calibrateSeverity("MEDIUM", f("ADVERSE", "SIGNIFICANT", "DEVIATES"));
    expect(r.severity).toBe("MEDIUM");
    expect(r.rationale).toMatchObject({ modelSeverity: "MEDIUM", adjusted: false });
  });

  it("lowers an overstated severity: mutual 60-day non-renewal window rated HIGH becomes MEDIUM", () => {
    const r = calibrateSeverity("HIGH", f("BALANCED", "MODERATE", "DEVIATES"));
    expect(r.severity).toBe("MEDIUM");
    expect(r.rationale).toMatchObject({ modelSeverity: "HIGH", adjusted: true, allowed: ["MEDIUM", "INFORMATIONAL"] });
  });

  it("raises an understated severity only when its own factors demand it", () => {
    expect(calibrateSeverity("LOW", f("ADVERSE", "SEVERE", "UNUSUAL")).severity).toBe("HIGH");
    expect(calibrateSeverity("INFORMATIONAL", f("ADVERSE", "SIGNIFICANT", "UNUSUAL")).severity).toBe("MEDIUM");
  });

  it("handles ambiguous borderline cases conservatively (no forced change)", () => {
    // Off-market but not unusual, significant exposure: anything from INFORMATIONAL to HIGH is the model's call.
    for (const s of ["HIGH", "MEDIUM", "LOW", "INFORMATIONAL"] as const) expect(calibrateSeverity(s, f("ADVERSE", "SIGNIFICANT", "DEVIATES")).severity).toBe(s);
    // A favourable clause can never be CRITICAL, however the model labels it.
    expect(calibrateSeverity("CRITICAL", f("FAVOURABLE", "SEVERE", "UNUSUAL")).severity).toBe("LOW");
  });
});
