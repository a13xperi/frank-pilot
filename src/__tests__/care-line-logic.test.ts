/**
 * Pure-logic tests for the Care Line: severity resolution (escalate-up only),
 * escalation decisions (§10), and the recipient-local calling window (§3).
 */

import { resolveSeverity } from "../modules/care-line/taxonomy";
import { evaluateEscalation } from "../modules/care-line/escalation";
import { isWithinCareCallWindow } from "../modules/care-line/dialer";

describe("resolveSeverity — server escalates up, never down", () => {
  it("uses the category base severity by default", () => {
    expect(resolveSeverity("move_in", null, false, false)).toBe("P3");
    expect(resolveSeverity("life_safety", null, false, false)).toBe("P0");
  });
  it("honors a MORE severe agent assessment", () => {
    expect(resolveSeverity("move_in", "P0", false, false)).toBe("P0");
  });
  it("never downgrades below the category base", () => {
    expect(resolveSeverity("life_safety", "P3", false, false)).toBe("P0");
  });
  it("a safety flag escalates to at least P1", () => {
    expect(resolveSeverity("unit_habitability", null, true, false)).toBe("P1");
  });
  it("a self-harm flag escalates to at least P1", () => {
    expect(resolveSeverity("general_info", null, false, true)).toBe("P1");
  });
});

describe("evaluateEscalation — §10 matrix", () => {
  it("P0 always escalates with a 911 instruction + on-call page", () => {
    const d = evaluateEscalation({ severity: "P0", safetyFlag: false, selfHarmFlag: false, isBusinessHours: true });
    expect(d).toMatchObject({ escalate: true, tell911: true, pageOnCall: true });
  });
  it("self-harm routes to 988 + human follow-up", () => {
    const d = evaluateEscalation({ severity: "P3", safetyFlag: false, selfHarmFlag: true, isBusinessHours: true });
    expect(d).toMatchObject({ escalate: true, refer988: true });
  });
  it("P1 after-hours pages on-call", () => {
    const d = evaluateEscalation({ severity: "P1", safetyFlag: false, selfHarmFlag: false, isBusinessHours: false });
    expect(d).toMatchObject({ escalate: true, pageOnCall: true });
    expect(d.reason).toMatch(/after-hours/);
  });
  it("P1 in business hours escalates same-day without paging", () => {
    const d = evaluateEscalation({ severity: "P1", safetyFlag: false, selfHarmFlag: false, isBusinessHours: true });
    expect(d.escalate).toBe(true);
    expect(d.pageOnCall).toBeFalsy();
  });
  it("P2/P3 do not escalate", () => {
    expect(evaluateEscalation({ severity: "P2", safetyFlag: false, selfHarmFlag: false, isBusinessHours: true }).escalate).toBe(false);
    expect(evaluateEscalation({ severity: "P3", safetyFlag: false, selfHarmFlag: false, isBusinessHours: true }).escalate).toBe(false);
  });
});

describe("isWithinCareCallWindow — recipient-local, fail-closed", () => {
  const tz = "America/Los_Angeles"; // PDT (UTC-7) in June
  it("allows midday local", () => {
    expect(isWithinCareCallWindow(new Date("2026-06-16T19:00:00Z"), tz)).toBe(true); // 12:00 PDT
  });
  it("blocks before 8am local", () => {
    expect(isWithinCareCallWindow(new Date("2026-06-16T13:00:00Z"), tz)).toBe(false); // 06:00 PDT
  });
  it("blocks at/after 9pm local", () => {
    expect(isWithinCareCallWindow(new Date("2026-06-16T04:00:00Z"), tz)).toBe(false); // 21:00 PDT
  });
  it("fails closed with no timezone on file", () => {
    expect(isWithinCareCallWindow(new Date("2026-06-16T19:00:00Z"), null)).toBe(false);
  });
  it("fails closed on a bad timezone string", () => {
    expect(isWithinCareCallWindow(new Date("2026-06-16T19:00:00Z"), "Nowhere/Nope")).toBe(false);
  });
});
