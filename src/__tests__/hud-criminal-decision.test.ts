/**
 * Tests for src/modules/screening/hud-criminal-decision.ts — the HUD/FHA
 * criminal-background decision engine.
 *
 * The compliance contract under test (docs/screening/hud-criminal-decision-matrix.md):
 *   - Only the federal MANDATORY floors auto-deny: §5.856 lifetime registrant,
 *     §960.204(a)(3) meth manufacture on assisted property, §960.204(a)(2)
 *     current illegal drug use, §960.204(a)(1) 3-yr drug-related eviction.
 *   - Every DISCRETIONARY record in lookback → individualized_review (a HOLD).
 *     Never auto-deny (Castro forbids time-blind blanket bans), never auto-pass.
 *   - Arrest-only / dismissed / acquitted / expunged → never used (clear).
 *   - Open / pending / undated → no-data → pause for individualized review.
 *   - Aged-out discretionary records → clear.
 *
 * A fixed `asOf` makes the lookback math deterministic.
 */

import {
  evaluateCriminalHistory,
  DEFAULT_LOOKBACK_POLICY,
  type CriminalRecord,
} from "../modules/screening/hud-criminal-decision";

const ASOF = new Date("2026-06-01T00:00:00Z");
const ev = (input: Parameters<typeof evaluateCriminalHistory>[0], policy?: any) =>
  evaluateCriminalHistory(input, { asOf: ASOF, policy });

describe("evaluateCriminalHistory — mandatory federal floors (auto-deny, no assessment)", () => {
  it("lifetime sex-offender registrant → mandatory_denial (§5.856)", () => {
    const r = ev({ records: [{ category: "felony_sexual", lifetimeRegistrant: true, disposition: "convicted" }] });
    expect(r.decision).toBe("mandatory_denial");
    expect(r.citations).toEqual(expect.arrayContaining([expect.stringMatching(/5\.856/)]));
    expect(r.assessmentFactors).toBeUndefined();
  });

  it("explicit sex_offense_lifetime_registrant category → mandatory_denial even without the flag", () => {
    const r = ev({ records: [{ category: "sex_offense_lifetime_registrant", disposition: "convicted" }] });
    expect(r.decision).toBe("mandatory_denial");
  });

  it("meth manufacture on assisted property → mandatory_denial (§960.204(a)(3))", () => {
    const r = ev({ records: [{ category: "meth_manufacture_assisted_property", disposition: "convicted" }] });
    expect(r.decision).toBe("mandatory_denial");
    expect(r.citations).toEqual(expect.arrayContaining([expect.stringMatching(/960\.204\(a\)\(3\)/)]));
  });

  it("current illegal drug use → mandatory_denial (§960.204(a)(2))", () => {
    const r = ev({ records: [{ category: "current_illegal_drug_use", disposition: "convicted" }] });
    expect(r.decision).toBe("mandatory_denial");
    expect(r.citations).toEqual(expect.arrayContaining([expect.stringMatching(/960\.204\(a\)\(2\)/)]));
  });

  it("drug-related eviction inside the 3-yr window → mandatory_denial (§960.204(a)(1))", () => {
    const r = ev({ records: [{ category: "drug_related_eviction", disposition: "convicted", dispositionDate: "2024-06-01" }] });
    expect(r.decision).toBe("mandatory_denial");
    expect(r.citations).toEqual(expect.arrayContaining([expect.stringMatching(/960\.204\(a\)\(1\)/)]));
  });

  it("drug-related eviction OLDER than 3 years → aged out (clear, not mandatory)", () => {
    const r = ev({ records: [{ category: "drug_related_eviction", disposition: "convicted", dispositionDate: "2020-01-01" }] });
    expect(r.decision).toBe("clear");
  });

  it("drug-related eviction with NO date → individualized_review, NOT mandatory (cannot prove the 3-yr window — never auto-deny blind)", () => {
    // §960.204(a)(1) is date-gated; an undated eviction can't be proven in-window,
    // so it must HOLD for staff to establish the date, not auto-deny on the
    // undated-in-lookback presumption (the missing-date fail-safe).
    const r = ev({ records: [{ category: "drug_related_eviction", disposition: "convicted" }] });
    expect(r.decision).toBe("individualized_review");
    expect(r.citations).toEqual(expect.arrayContaining([expect.stringMatching(/960\.204\(a\)\(1\)/)]));
    expect(r.assessmentFactors?.timeElapsedYears).toBeNull();
  });

  it("undated drug-eviction stays individualized_review even with undatedConvictionInLookback=false (a mandatory floor never auto-clears on the policy knob)", () => {
    const r = ev(
      { records: [{ category: "drug_related_eviction", disposition: "convicted" }] },
      { undatedConvictionInLookback: false }
    );
    expect(r.decision).toBe("individualized_review");
  });

  it("meth manufacture NOT on assisted property is discretionary, not the floor → individualized_review", () => {
    const r = ev({
      records: [{ category: "meth_manufacture_assisted_property", onAssistedProperty: false, disposition: "convicted", dispositionDate: "2024-01-01" }],
    });
    expect(r.decision).toBe("individualized_review");
  });

  it("a lifetime registrant flag overrides an otherwise-ignored disposition", () => {
    const r = ev({ records: [{ category: "felony_sexual", lifetimeRegistrant: true, disposition: "dismissed" }] });
    expect(r.decision).toBe("mandatory_denial");
  });
});

describe("evaluateCriminalHistory — discretionary records (individualized assessment)", () => {
  it("felony_violent inside the 7-yr lookback → individualized_review (NOT a fail)", () => {
    const r = ev({ records: [{ category: "felony_violent", disposition: "convicted", releaseDate: "2022-06-01" }] });
    expect(r.decision).toBe("individualized_review");
    expect(r.assessmentFactors?.mitigatingEvidenceRequired).toBe(true);
    expect(r.assessmentFactors?.applicableLookbackYears).toBe(7);
    expect(r.assessmentFactors?.timeElapsedYears).toBeCloseTo(4.0, 0);
    expect(r.assessmentFactors?.natureAndSeverity.length).toBeGreaterThan(0);
    expect(r.assessmentFactors?.workflow).toMatch(/Castro/);
  });

  it("felony_nonviolent inside the 5-yr lookback → individualized_review", () => {
    const r = ev({ records: [{ category: "felony_nonviolent", disposition: "convicted", dispositionDate: "2023-01-01" }] });
    expect(r.decision).toBe("individualized_review");
    expect(r.assessmentFactors?.applicableLookbackYears).toBe(5);
  });

  it("felony_nonviolent OUTSIDE the 5-yr lookback → aged out (clear)", () => {
    const r = ev({ records: [{ category: "felony_nonviolent", disposition: "convicted", dispositionDate: "2018-01-01" }] });
    expect(r.decision).toBe("clear");
  });

  it("misdemeanor_violent inside the 3-yr lookback → individualized_review", () => {
    const r = ev({ records: [{ category: "misdemeanor_violent", disposition: "convicted", dispositionDate: "2024-06-01" }] });
    expect(r.decision).toBe("individualized_review");
    expect(r.assessmentFactors?.applicableLookbackYears).toBe(3);
  });

  it("open / pending charge → individualized_review (no-data pause)", () => {
    const r = ev({ records: [{ category: "felony_nonviolent", disposition: "pending" }] });
    expect(r.decision).toBe("individualized_review");
    expect(r.assessmentFactors?.timeElapsedYears).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/pending|no-data/i);
  });

  it("an undated conviction defaults to in-lookback → individualized_review (never silently aged out)", () => {
    const r = ev({ records: [{ category: "felony_violent", disposition: "convicted" }] });
    expect(r.decision).toBe("individualized_review");
    expect(r.assessmentFactors?.timeElapsedYears).toBeNull();
  });

  it("an 'other' (unclassified) conviction conservatively requires individualized_review", () => {
    const r = ev({ records: [{ category: "other", disposition: "convicted", dispositionDate: "2025-01-01" }] });
    expect(r.decision).toBe("individualized_review");
  });
});

describe("evaluateCriminalHistory — records that must never be used", () => {
  it.each(["arrest_only", "dismissed", "acquitted", "expunged"] as const)(
    "%s disposition → clear (Castro §III.A: not a defensible basis)",
    (disposition) => {
      const r = ev({ records: [{ category: "felony_violent", disposition, dispositionDate: "2025-01-01" }] });
      expect(r.decision).toBe("clear");
    }
  );

  it("no records / empty input → clear", () => {
    expect(ev({}).decision).toBe("clear");
    expect(ev({ records: [] }).decision).toBe("clear");
  });
});

describe("evaluateCriminalHistory — precedence & policy", () => {
  it("a mandatory floor outranks a discretionary record in the same history", () => {
    const r = ev({
      records: [
        { category: "felony_nonviolent", disposition: "convicted", dispositionDate: "2024-01-01" },
        { category: "current_illegal_drug_use", disposition: "convicted" },
      ],
    });
    expect(r.decision).toBe("mandatory_denial");
  });

  it("operator policy can TIGHTEN a lookback (still individualized_review, never auto-fail)", () => {
    const rec: CriminalRecord = { category: "felony_nonviolent", disposition: "convicted", dispositionDate: "2023-01-01" };
    expect(ev({ records: [rec] }).decision).toBe("individualized_review"); // default 5yr → in
    // Tighten to 1 year → the 3-yr-old conviction ages out to clear.
    expect(ev({ records: [rec] }, { felonyNonviolentYears: 1 }).decision).toBe("clear");
  });

  it("undatedConvictionInLookback=false ages out an undated conviction → clear", () => {
    const r = ev({ records: [{ category: "felony_violent", disposition: "convicted" }] }, { undatedConvictionInLookback: false });
    expect(r.decision).toBe("clear");
  });

  it("DEFAULT_LOOKBACK_POLICY reflects the matrix ceilings", () => {
    expect(DEFAULT_LOOKBACK_POLICY.felonyViolentYears).toBe(7);
    expect(DEFAULT_LOOKBACK_POLICY.felonyNonviolentYears).toBe(5);
    expect(DEFAULT_LOOKBACK_POLICY.drugEvictionYears).toBe(3);
    expect(DEFAULT_LOOKBACK_POLICY.undatedConvictionInLookback).toBe(true);
  });
});

describe("evaluateCriminalHistory — legacy summary-flag path (current sandbox vendor)", () => {
  it("sexOffenses:true → mandatory_denial (§5.856 registry hit)", () => {
    const r = ev({ felonies: 0, sexOffenses: true, violentCrimes: false });
    expect(r.decision).toBe("mandatory_denial");
    expect(r.citations).toEqual(expect.arrayContaining([expect.stringMatching(/5\.856/)]));
  });

  it("felonies>0 → individualized_review (no time-blind ban)", () => {
    const r = ev({ felonies: 2, sexOffenses: false, violentCrimes: false });
    expect(r.decision).toBe("individualized_review");
    expect(r.assessmentFactors?.mitigatingEvidenceRequired).toBe(true);
  });

  it("violentCrimes:true → individualized_review", () => {
    const r = ev({ felonies: 0, sexOffenses: false, violentCrimes: true });
    expect(r.decision).toBe("individualized_review");
  });

  it("explicit mandatory flags → mandatory_denial", () => {
    expect(ev({ methManufactureOnAssistedProperty: true }).decision).toBe("mandatory_denial");
    expect(ev({ currentIllegalDrugUse: true }).decision).toBe("mandatory_denial");
    expect(ev({ drugRelatedEvictionWithinLookback: true }).decision).toBe("mandatory_denial");
  });

  it("clean summary (no felonies/offenses) → clear", () => {
    const r = ev({ felonies: 0, sexOffenses: false, violentCrimes: false });
    expect(r.decision).toBe("clear");
  });

  it("structured records are authoritative — legacy felonies count is ignored when records are present", () => {
    // An aged-out structured felony + a noisy legacy felonies:5 → the records win → clear.
    const r = ev({
      records: [{ category: "felony_nonviolent", disposition: "convicted", dispositionDate: "2015-01-01" }],
      felonies: 5,
    });
    expect(r.decision).toBe("clear");
  });

  it("explicit mandatory flags still apply alongside structured records", () => {
    const r = ev({
      records: [{ category: "felony_nonviolent", disposition: "convicted", dispositionDate: "2015-01-01" }],
      sexOffenses: true,
    });
    expect(r.decision).toBe("mandatory_denial");
  });
});
