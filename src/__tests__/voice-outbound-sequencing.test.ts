/**
 * Unit tests for src/modules/voice-outbound/sequencing.ts — the pure
 * compliance rules behind outbound wait-list calling.
 *
 * Everything here is clock-injected, so the TCPA quiet-hours assertions use
 * fixed UTC instants that map to known America/Los_Angeles wall times
 * (June = PDT, UTC-7). No mocks needed.
 */

import {
  evaluateEligibility,
  isWithinCallingHours,
  localHour,
  nextAllowedDialTime,
  windowsAfterContact,
  MAX_CONTACT_ATTEMPTS,
  RESPONSE_WINDOW_HOURS,
  REMOVAL_WINDOW_DAYS,
  type EligibilityInput,
} from "../modules/voice-outbound/sequencing";

const TZ = "America/Los_Angeles";

// 2026-06-12 PDT wall-clock anchors (UTC-7)
const AT_0759_LOCAL = new Date("2026-06-12T14:59:00Z");
const AT_0800_LOCAL = new Date("2026-06-12T15:00:00Z");
const AT_1000_LOCAL = new Date("2026-06-12T17:00:00Z");
const AT_2059_LOCAL = new Date("2026-06-13T03:59:00Z"); // 8:59pm Jun 12 PDT
const AT_2100_LOCAL = new Date("2026-06-13T04:00:00Z"); // 9:00pm Jun 12 PDT

describe("TCPA calling hours", () => {
  it("maps instants to recipient-local hours", () => {
    expect(localHour(AT_0800_LOCAL, TZ)).toBe(8);
    expect(localHour(AT_2100_LOCAL, TZ)).toBe(21);
  });

  it("opens at exactly 8am local and closes at exactly 9pm local", () => {
    expect(isWithinCallingHours(AT_0759_LOCAL, TZ)).toBe(false);
    expect(isWithinCallingHours(AT_0800_LOCAL, TZ)).toBe(true);
    expect(isWithinCallingHours(AT_1000_LOCAL, TZ)).toBe(true);
    expect(isWithinCallingHours(AT_2059_LOCAL, TZ)).toBe(true);
    expect(isWithinCallingHours(AT_2100_LOCAL, TZ)).toBe(false);
  });

  it("nextAllowedDialTime returns `from` unchanged when already callable", () => {
    expect(nextAllowedDialTime(AT_1000_LOCAL, TZ)).toBe(AT_1000_LOCAL);
  });

  it("nextAllowedDialTime rolls a 9pm dial to the next morning", () => {
    const next = nextAllowedDialTime(AT_2100_LOCAL, TZ);
    expect(next.getTime()).toBeGreaterThan(AT_2100_LOCAL.getTime());
    expect(isWithinCallingHours(next, TZ)).toBe(true);
    expect(localHour(next, TZ)).toBe(8);
  });

  it("nextAllowedDialTime rolls a pre-8am dial to the same morning", () => {
    const next = nextAllowedDialTime(AT_0759_LOCAL, TZ);
    expect(localHour(next, TZ)).toBe(8);
    // Same calendar morning — within an hour of the input.
    expect(next.getTime() - AT_0759_LOCAL.getTime()).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe("windowsAfterContact", () => {
  const now = AT_1000_LOCAL;

  it("first contact opens both windows anchored correctly", () => {
    const next = windowsAfterContact(
      {
        contactAttempts: 0,
        firstContactedAt: null,
        lastContactedAt: null,
        responseWindowExpiresAt: null,
        removalWindowExpiresAt: null,
      },
      now
    );
    expect(next.contactAttempts).toBe(1);
    expect(next.firstContactedAt).toEqual(now);
    expect(next.lastContactedAt).toEqual(now);
    expect(next.responseWindowExpiresAt!.getTime()).toBe(
      now.getTime() + RESPONSE_WINDOW_HOURS * 3600_000
    );
    expect(next.removalWindowExpiresAt!.getTime()).toBe(
      now.getTime() + REMOVAL_WINDOW_DAYS * 86_400_000
    );
  });

  it("repeat contact keeps the removal window anchored at FIRST contact", () => {
    const first = new Date(now.getTime() - 3 * 86_400_000);
    const next = windowsAfterContact(
      {
        contactAttempts: 1,
        firstContactedAt: first,
        lastContactedAt: first,
        responseWindowExpiresAt: new Date(first.getTime() + RESPONSE_WINDOW_HOURS * 3600_000),
        removalWindowExpiresAt: new Date(first.getTime() + REMOVAL_WINDOW_DAYS * 86_400_000),
      },
      now
    );
    expect(next.contactAttempts).toBe(2);
    expect(next.firstContactedAt).toEqual(first);
    expect(next.lastContactedAt).toEqual(now);
    // Response window re-opens from NOW; removal window does not move.
    expect(next.responseWindowExpiresAt!.getTime()).toBe(
      now.getTime() + RESPONSE_WINDOW_HOURS * 3600_000
    );
    expect(next.removalWindowExpiresAt!.getTime()).toBe(
      first.getTime() + REMOVAL_WINDOW_DAYS * 86_400_000
    );
  });
});

describe("evaluateEligibility", () => {
  const now = AT_1000_LOCAL;
  const fresh: EligibilityInput = {
    status: "pending",
    phone: "+17025550100",
    consentOutbound: true,
    contactAttempts: 0,
    firstContactedAt: null,
    lastContactedAt: null,
    responseWindowExpiresAt: null,
    removalWindowExpiresAt: null,
  };

  it("a fresh consented entry with a phone is eligible", () => {
    expect(evaluateEligibility(fresh, now)).toEqual({ eligible: true });
  });

  it("non-contactable statuses are filtered", () => {
    for (const status of ["queued", "interested", "declined", "removal_review", "removed", "converted"]) {
      const v = evaluateEligibility({ ...fresh, status }, now);
      expect(v).toMatchObject({ eligible: false, reason: "status_not_contactable" });
    }
  });

  it("no phone → ineligible", () => {
    expect(evaluateEligibility({ ...fresh, phone: null }, now)).toMatchObject({
      eligible: false,
      reason: "no_phone",
    });
  });

  it("no consent → ineligible (TCPA PEWC gate)", () => {
    expect(evaluateEligibility({ ...fresh, consentOutbound: false }, now)).toMatchObject({
      eligible: false,
      reason: "no_consent",
    });
  });

  it("expired 12-day removal window → ineligible AND surfaced for review", () => {
    const v = evaluateEligibility(
      {
        ...fresh,
        status: "contacted",
        contactAttempts: 1,
        removalWindowExpiresAt: new Date(now.getTime() - 1000),
      },
      now
    );
    expect(v).toMatchObject({
      eligible: false,
      reason: "removal_window_expired",
      needsRemovalReview: true,
    });
  });

  it("maxed attempts → ineligible AND surfaced for review", () => {
    const v = evaluateEligibility(
      {
        ...fresh,
        status: "contacted",
        contactAttempts: MAX_CONTACT_ATTEMPTS,
        responseWindowExpiresAt: new Date(now.getTime() - 1000),
        removalWindowExpiresAt: new Date(now.getTime() + 86_400_000),
      },
      now
    );
    expect(v).toMatchObject({ eligible: false, reason: "max_attempts", needsRemovalReview: true });
  });

  it("open 48-hour response window → wait, do not re-propose", () => {
    const v = evaluateEligibility(
      {
        ...fresh,
        status: "contacted",
        contactAttempts: 1,
        responseWindowExpiresAt: new Date(now.getTime() + 3600_000),
        removalWindowExpiresAt: new Date(now.getTime() + 10 * 86_400_000),
      },
      now
    );
    expect(v).toMatchObject({ eligible: false, reason: "awaiting_response_window" });
  });

  it("expired response window inside the removal window → eligible again", () => {
    const v = evaluateEligibility(
      {
        ...fresh,
        status: "contacted",
        contactAttempts: 1,
        responseWindowExpiresAt: new Date(now.getTime() - 1000),
        removalWindowExpiresAt: new Date(now.getTime() + 10 * 86_400_000),
      },
      now
    );
    expect(v).toEqual({ eligible: true });
  });
});
