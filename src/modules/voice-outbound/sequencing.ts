/**
 * Compliance sequencing for outbound wait-list calling (DM-FRANK-029).
 *
 * Pure functions only — no DB, no clock reads. Callers pass `now` explicitly
 * so the rules are unit-testable against fixed instants and the service layer
 * owns the single Date.now() read per request.
 *
 * The two windows (HUD 4350.3 Ch. 4 waiting-list management, as practiced by
 * the operator):
 *   - 48-hour response window — opened by every contact attempt; the entry is
 *     not re-proposed while it's open (the applicant gets time to call back).
 *   - 12-day removal window — anchored at FIRST contact; when it lapses the
 *     entry is surfaced as 'removal_review'. Removal is NEVER automatic.
 *
 * TCPA quiet hours: 47 CFR §64.1200(c)(1) — no calls before 8am or after 9pm
 * at the called party's location. The list is single-market (Las Vegas), so
 * recipient-local defaults to America/Los_Angeles; OUTBOUND_LOCAL_TZ overrides
 * per deploy.
 *
 * Sequencing FILTERS, it never REORDERS — callers must keep source_position
 * ordering from the operator's list.
 */

export const RESPONSE_WINDOW_HOURS = 48;
export const REMOVAL_WINDOW_DAYS = 12;
export const MAX_CONTACT_ATTEMPTS = 3;

/** TCPA §64.1200(c)(1): callable window is [8am, 9pm) recipient-local. */
export const TCPA_EARLIEST_LOCAL_HOUR = 8;
export const TCPA_LATEST_LOCAL_HOUR = 21;

const DEFAULT_TZ = "America/Los_Angeles";

export function outboundLocalTimeZone(): string {
  return process.env.OUTBOUND_LOCAL_TZ || DEFAULT_TZ;
}

/** Hour-of-day (0–23) of `instant` in the recipient's time zone. */
export function localHour(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(instant);
  return parseInt(formatted, 10);
}

export function isWithinCallingHours(instant: Date, timeZone: string): boolean {
  const hour = localHour(instant, timeZone);
  return hour >= TCPA_EARLIEST_LOCAL_HOUR && hour < TCPA_LATEST_LOCAL_HOUR;
}

/**
 * Earliest instant >= `from` that falls inside calling hours. Walks forward
 * in 15-minute steps rather than doing time-zone date math by hand — DST-safe
 * by construction and bounded (the quiet window is 11h, so <48 steps).
 */
export function nextAllowedDialTime(from: Date, timeZone: string): Date {
  if (isWithinCallingHours(from, timeZone)) return from;
  const STEP_MS = 15 * 60 * 1000;
  let candidate = from.getTime();
  for (let i = 0; i < 96; i++) {
    candidate += STEP_MS;
    const at = new Date(candidate);
    if (isWithinCallingHours(at, timeZone)) return at;
  }
  // Unreachable for any real time zone; fail loud rather than dial illegally.
  throw new Error(`nextAllowedDialTime found no callable instant within 24h (tz=${timeZone})`);
}

export interface EntryContactState {
  contactAttempts: number;
  firstContactedAt: Date | null;
  lastContactedAt: Date | null;
  responseWindowExpiresAt: Date | null;
  removalWindowExpiresAt: Date | null;
}

/** Window/counter updates after a real (non-dry-run) contact attempt. */
export function windowsAfterContact(prev: EntryContactState, now: Date): EntryContactState {
  const first = prev.firstContactedAt ?? now;
  return {
    contactAttempts: prev.contactAttempts + 1,
    firstContactedAt: first,
    lastContactedAt: now,
    responseWindowExpiresAt: new Date(now.getTime() + RESPONSE_WINDOW_HOURS * 3600_000),
    removalWindowExpiresAt: new Date(first.getTime() + REMOVAL_WINDOW_DAYS * 86_400_000),
  };
}

export interface EligibilityInput extends EntryContactState {
  status: string;
  phone: string | null;
  consentOutbound: boolean;
}

export type IneligibleReason =
  | "status_not_contactable"
  | "no_phone"
  | "no_consent"
  | "removal_window_expired"
  | "max_attempts"
  | "awaiting_response_window";

export type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: IneligibleReason; needsRemovalReview: boolean };

/**
 * May this entry be PROPOSED for a call right now?
 *
 * Reason ordering is deliberate: the review-surfacing conditions
 * (removal_window_expired, max_attempts) are reported before the merely
 * temporal one (awaiting_response_window) so the service can flip the entry
 * to 'removal_review' instead of silently skipping it forever.
 */
export function evaluateEligibility(entry: EligibilityInput, now: Date): Eligibility {
  if (entry.status !== "pending" && entry.status !== "contacted") {
    return { eligible: false, reason: "status_not_contactable", needsRemovalReview: false };
  }
  if (!entry.phone) {
    return { eligible: false, reason: "no_phone", needsRemovalReview: false };
  }
  if (!entry.consentOutbound) {
    // TCPA PEWC gate — no consent record, no AI call. Ever.
    return { eligible: false, reason: "no_consent", needsRemovalReview: false };
  }
  if (entry.removalWindowExpiresAt && now.getTime() > entry.removalWindowExpiresAt.getTime()) {
    return { eligible: false, reason: "removal_window_expired", needsRemovalReview: true };
  }
  if (entry.contactAttempts >= MAX_CONTACT_ATTEMPTS) {
    return { eligible: false, reason: "max_attempts", needsRemovalReview: true };
  }
  if (
    entry.contactAttempts > 0 &&
    entry.responseWindowExpiresAt &&
    now.getTime() < entry.responseWindowExpiresAt.getTime()
  ) {
    return { eligible: false, reason: "awaiting_response_window", needsRemovalReview: false };
  }
  return { eligible: true };
}
