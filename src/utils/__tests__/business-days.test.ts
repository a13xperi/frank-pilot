/**
 * Tests for src/utils/business-days.ts
 *
 * Pure date arithmetic for the FCRA pre-adverse-action window. All cases pass an
 * explicit `from` date so the suite is deterministic regardless of the day the
 * test runs. Weekends are skipped; holidays are intentionally out of scope (a
 * skipped holiday can only LENGTHEN the window, never shorten it).
 *
 * Calendar anchors used below (all UTC-naive local dates):
 *   2026-06-08 = Monday
 *   2026-06-12 = Friday
 *   2026-06-13 = Saturday
 *   2026-06-14 = Sunday
 */

import { addBusinessDays, isBusinessDay } from "../business-days";

describe("isBusinessDay", () => {
  it("returns true Monday–Friday", () => {
    // 2026-06-08 Mon … 2026-06-12 Fri
    for (let d = 8; d <= 12; d++) {
      expect(isBusinessDay(new Date(2026, 5, d))).toBe(true);
    }
  });

  it("returns false on Saturday and Sunday", () => {
    expect(isBusinessDay(new Date(2026, 5, 13))).toBe(false); // Sat
    expect(isBusinessDay(new Date(2026, 5, 14))).toBe(false); // Sun
  });
});

describe("addBusinessDays", () => {
  it("adds N business days within a single work week (Mon + 4 = Fri)", () => {
    const from = new Date(2026, 5, 8); // Mon
    const out = addBusinessDays(from, 4);
    expect(out.getFullYear()).toBe(2026);
    expect(out.getMonth()).toBe(5);
    expect(out.getDate()).toBe(12); // Fri
  });

  it("skips the weekend when the window crosses it (Thu + 2 = Mon)", () => {
    const from = new Date(2026, 5, 11); // Thu
    const out = addBusinessDays(from, 2); // Fri, then Mon (Sat/Sun skipped)
    expect(out.getDate()).toBe(15); // Mon 2026-06-15
  });

  it("the default 5-day window from a Monday lands the next Monday", () => {
    const from = new Date(2026, 5, 8); // Mon
    const out = addBusinessDays(from, 5); // Tue..Fri = 4, then Mon = 5
    expect(out.getDate()).toBe(15); // Mon 2026-06-15
  });

  it("starting on a Friday, +1 business day is the following Monday", () => {
    const from = new Date(2026, 5, 12); // Fri
    const out = addBusinessDays(from, 1);
    expect(out.getDate()).toBe(15); // Mon
  });

  it("starting on a Saturday, +1 business day is Monday (does not count Sat/Sun)", () => {
    const from = new Date(2026, 5, 13); // Sat
    const out = addBusinessDays(from, 1);
    expect(out.getDate()).toBe(15); // Mon
  });

  it("preserves the time-of-day of `from`", () => {
    const from = new Date(2026, 5, 8, 14, 37, 12, 500); // Mon 14:37:12.500
    const out = addBusinessDays(from, 3);
    expect(out.getHours()).toBe(14);
    expect(out.getMinutes()).toBe(37);
    expect(out.getSeconds()).toBe(12);
    expect(out.getMilliseconds()).toBe(500);
  });

  it("does not mutate the input date", () => {
    const from = new Date(2026, 5, 8);
    const before = from.getTime();
    addBusinessDays(from, 5);
    expect(from.getTime()).toBe(before);
  });

  it("returns a copy unchanged for n <= 0 (degenerate window finalizes next tick)", () => {
    const from = new Date(2026, 5, 8, 9, 0, 0);
    for (const n of [0, -1, -10]) {
      const out = addBusinessDays(from, n);
      expect(out.getTime()).toBe(from.getTime());
      expect(out).not.toBe(from); // still a fresh object
    }
  });

  it("returns a copy unchanged for non-finite n (NaN / Infinity)", () => {
    const from = new Date(2026, 5, 8);
    expect(addBusinessDays(from, NaN).getTime()).toBe(from.getTime());
    expect(addBusinessDays(from, Infinity).getTime()).toBe(from.getTime());
  });

  it("never lands on a weekend for any N from a weekday start", () => {
    const from = new Date(2026, 5, 8); // Mon
    for (let n = 1; n <= 30; n++) {
      expect(isBusinessDay(addBusinessDays(from, n))).toBe(true);
    }
  });
});
