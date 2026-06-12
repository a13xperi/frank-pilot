/**
 * Unit tests for src/modules/voice-outbound/service.ts — import, proposal,
 * human review, and the dial guard.
 *
 * Database fully mocked (house pattern, see voice-intake-service.test.ts):
 * these pin the SQL we issue, the state transitions, and the tape stamps —
 * especially the TCPA invariants:
 *   - nothing is proposed or dialed without consent
 *   - dials refuse outside 8am–9pm recipient-local
 *   - EVERY attempt (dry runs included) stamps VOICE_INTAKE_OUTBOUND_ATTEMPTED
 *   - dry runs consume no contact attempt and open no windows
 */

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStampTape = jest.fn().mockResolvedValue(null);
jest.mock("../modules/tape", () => {
  const real = jest.requireActual("../modules/tape");
  return { ...real, stampTape: mockStampTape };
});

// voice-outbound/service reuses normalizePhone from voice-intake/service,
// whose module graph pulls in the magic-link transport — stub it out.
jest.mock("../modules/auth/magic-link-service", () => ({
  sendMagicLinkSms: jest.fn(),
}));

const mockPlaceOutboundCall = jest.fn();
jest.mock("../modules/voice-outbound/dialer", () => ({
  placeOutboundCall: (...args: unknown[]) => mockPlaceOutboundCall(...args),
  dialingEnabled: jest.fn(),
}));

import {
  dialQueueItem,
  importWaitlist,
  proposeCalls,
  reviewQueueItem,
} from "../modules/voice-outbound/service";

const BATCH_ID = "11111111-1111-1111-1111-111111111111";
const ENTRY_ID = "22222222-2222-2222-2222-222222222222";
const QUEUE_ID = "33333333-3333-3333-3333-333333333333";
const ACTOR_ID = "44444444-4444-4444-4444-444444444444";

// 10:00am PDT on Jun 12 2026 — squarely inside TCPA hours.
const NOW_CALLABLE = new Date("2026-06-12T17:00:00Z");
// 9:30pm PDT on Jun 12 2026 — inside quiet hours.
const NOW_QUIET = new Date("2026-06-13T04:30:00Z");

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OUTBOUND_LOCAL_TZ;
  mockQuery.mockResolvedValue({ rows: [] });
});

const sqlCalls = (): string[] => mockQuery.mock.calls.map((c) => String(c[0]));

// ── importWaitlist ──────────────────────────────────────────────────────────

describe("importWaitlist", () => {
  it("inserts batch + rows, honors explicit positions, normalizes phones, stamps the tape", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: BATCH_ID }] }); // batch INSERT

    const result = await importWaitlist({
      sourceLabel: "hawkins-csv-2026-06-12",
      propertyId: null,
      importedBy: ACTOR_ID,
      rows: [
        {
          position: 7,
          name: "Jane Doe",
          phone: "(702) 555-0100",
          email: null,
          bedrooms: 2,
          listedAt: "2025-11-03",
          consent: true,
          consentSource: "signed application",
        },
        {
          position: null, // no explicit position → continues after the max seen
          name: "John Roe",
          phone: null,
          email: "john@example.com",
          bedrooms: null,
          listedAt: null,
          consent: false,
          consentSource: null,
        },
      ],
    });

    expect(result).toMatchObject({ batchId: BATCH_ID, imported: 2, skipped: 0 });

    const entryInserts = mockQuery.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT INTO external_waitlist_entries")
    );
    expect(entryInserts).toHaveLength(2);
    // Row 1: explicit position 7, normalized E.164 phone, consent true.
    expect(entryInserts[0][1]).toEqual(
      expect.arrayContaining([7, "Jane Doe", "+17025550100", true])
    );
    // Row 2: position continues after the max (8), null phone survives.
    expect(entryInserts[1][1]).toEqual(expect.arrayContaining([8, "John Roe", null, false]));

    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "WAITING_LIST_APP_CAPTURED",
        actor: ACTOR_ID,
        payload: expect.objectContaining({ surface: "outbound_import", imported: 2 }),
      })
    );
  });

  it("skips unnamed rows and reports them without aborting the batch", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: BATCH_ID }] });
    const result = await importWaitlist({
      sourceLabel: "messy-sheet",
      propertyId: null,
      importedBy: ACTOR_ID,
      rows: [
        { position: 1, name: "", phone: null, email: null, bedrooms: null, listedAt: null, consent: false, consentSource: null },
        { position: 2, name: "Real Person", phone: null, email: null, bedrooms: null, listedAt: null, consent: true, consentSource: null },
      ],
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/no name/);
  });
});

// ── proposeCalls ────────────────────────────────────────────────────────────

const candidateRow = (overrides: Record<string, unknown> = {}) => ({
  id: ENTRY_ID,
  status: "pending",
  phone: "+17025550100",
  full_name: "Jane Doe",
  source_position: 1,
  consent_outbound: true,
  contact_attempts: 0,
  first_contacted_at: null,
  last_contacted_at: null,
  response_window_expires_at: null,
  removal_window_expires_at: null,
  ...overrides,
});

describe("proposeCalls", () => {
  it("proposes eligible entries in source order with a consent snapshot", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [candidateRow()] }); // candidates
    mockQuery.mockResolvedValueOnce({ rows: [{ id: QUEUE_ID }] }); // queue INSERT
    // entry status UPDATE falls through to the default {rows: []}

    const result = await proposeCalls({
      propertyId: null,
      limit: 10,
      actorId: ACTOR_ID,
      now: NOW_CALLABLE,
    });

    expect(result.proposed).toHaveLength(1);
    expect(result.proposed[0]).toMatchObject({ queueId: QUEUE_ID, entryId: ENTRY_ID, position: 1 });
    // Already inside calling hours → dialable immediately.
    expect(result.proposed[0].scheduledAfter).toBe(NOW_CALLABLE.toISOString());

    const queueInsert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO outbound_call_queue")
    )!;
    expect(queueInsert[1]).toEqual(
      expect.arrayContaining([ENTRY_ID, 1, ACTOR_ID, true]) // attempt 1, consent snapshot
    );
    expect(sqlCalls().some((s) => s.includes("SET status = 'queued'"))).toBe(true);
  });

  it("skips no-consent entries and flips lapsed ones to removal_review (never auto-removes)", async () => {
    const lapsed = candidateRow({
      id: "55555555-5555-5555-5555-555555555555",
      status: "contacted",
      contact_attempts: 1,
      source_position: 2,
      removal_window_expires_at: new Date(NOW_CALLABLE.getTime() - 1000),
    });
    const noConsent = candidateRow({
      id: "66666666-6666-6666-6666-666666666666",
      source_position: 3,
      consent_outbound: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [lapsed, noConsent] });

    const result = await proposeCalls({
      propertyId: null,
      limit: 10,
      actorId: ACTOR_ID,
      now: NOW_CALLABLE,
    });

    expect(result.proposed).toHaveLength(0);
    expect(result.flaggedForReview).toBe(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "removal_window_expired" }),
        expect.objectContaining({ reason: "no_consent" }),
      ])
    );
    expect(sqlCalls().some((s) => s.includes("SET status = 'removal_review'"))).toBe(true);
    expect(sqlCalls().some((s) => s.includes("INSERT INTO outbound_call_queue"))).toBe(false);
  });

  it("schedules quiet-hour proposals for the next callable morning", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [candidateRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: QUEUE_ID }] });

    const result = await proposeCalls({
      propertyId: null,
      limit: 10,
      actorId: ACTOR_ID,
      now: NOW_QUIET,
    });
    const scheduled = new Date(result.proposed[0].scheduledAfter);
    expect(scheduled.getTime()).toBeGreaterThan(NOW_QUIET.getTime());
  });
});

// ── reviewQueueItem ─────────────────────────────────────────────────────────

describe("reviewQueueItem", () => {
  it("approve transitions proposed → approved and stamps the decision", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ entry_id: ENTRY_ID }] });
    const result = await reviewQueueItem({ queueId: QUEUE_ID, decision: "approve", actorId: ACTOR_ID });
    expect(result.status).toBe("approved");
    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_DECISION",
        payload: expect.objectContaining({ surface: "outbound_queue", decision: "approved" }),
      })
    );
  });

  it("reject reverts the entry to its contactable state", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ entry_id: ENTRY_ID }] });
    await reviewQueueItem({ queueId: QUEUE_ID, decision: "reject", actorId: ACTOR_ID, reason: "wrong person" });
    expect(
      sqlCalls().some((s) => s.includes("CASE WHEN contact_attempts > 0 THEN 'contacted' ELSE 'pending'"))
    ).toBe(true);
  });

  it("throws BAD_QUEUE_STATE when the row is not awaiting review", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      reviewQueueItem({ queueId: QUEUE_ID, decision: "approve", actorId: ACTOR_ID })
    ).rejects.toMatchObject({ code: "BAD_QUEUE_STATE" });
  });
});

// ── dialQueueItem ───────────────────────────────────────────────────────────

const dialRow = (overrides: Record<string, unknown> = {}) => ({
  queue_id: QUEUE_ID,
  queue_status: "approved",
  attempt_number: 1,
  consent_snapshot: true,
  scheduled_after: null,
  entry_id: ENTRY_ID,
  full_name: "Jane Doe",
  phone: "+17025550100",
  consent_outbound: true,
  contact_attempts: 0,
  first_contacted_at: null,
  last_contacted_at: null,
  response_window_expires_at: null,
  removal_window_expires_at: null,
  property_id: null,
  ...overrides,
});

describe("dialQueueItem", () => {
  it("refuses anything not in 'approved' — the human gate is not skippable", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dialRow({ queue_status: "proposed" })] });
    const result = await dialQueueItem({ queueId: QUEUE_ID, actorId: ACTOR_ID, now: NOW_CALLABLE });
    expect(result).toEqual({ placed: false, refused: "not_approved" });
    expect(mockPlaceOutboundCall).not.toHaveBeenCalled();
  });

  it("refuses when consent is missing on either the snapshot or the live entry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dialRow({ consent_outbound: false })] });
    const result = await dialQueueItem({ queueId: QUEUE_ID, actorId: ACTOR_ID, now: NOW_CALLABLE });
    expect(result).toEqual({ placed: false, refused: "no_consent" });
    expect(mockPlaceOutboundCall).not.toHaveBeenCalled();
  });

  it("refuses outside TCPA hours and reports the next callable instant", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dialRow()] });
    const result = await dialQueueItem({ queueId: QUEUE_ID, actorId: ACTOR_ID, now: NOW_QUIET });
    expect(result).toMatchObject({ placed: false, refused: "outside_calling_hours" });
    if (result.placed === false && result.refused === "outside_calling_hours") {
      expect(new Date(result.nextAllowedAt).getTime()).toBeGreaterThan(NOW_QUIET.getTime());
    }
    expect(mockPlaceOutboundCall).not.toHaveBeenCalled();
  });

  it("dry run: full pipeline + tape stamp, but no attempt consumed and no windows opened", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dialRow()] });
    mockPlaceOutboundCall.mockResolvedValueOnce({
      dryRun: true,
      ok: true,
      conversationId: null,
      callSid: null,
    });

    const result = await dialQueueItem({ queueId: QUEUE_ID, actorId: ACTOR_ID, now: NOW_CALLABLE });
    expect(result).toEqual({ placed: true, dryRun: true, conversationId: null });

    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_OUTBOUND_ATTEMPTED",
        payload: expect.objectContaining({ dryRun: true, consentSnapshot: true }),
      })
    );
    expect(sqlCalls().some((s) => s.includes("SET status = 'completed'") || s.includes("'dry_run'"))).toBe(true);
    // Entry reverts to contactable; the windows UPDATE never runs.
    expect(sqlCalls().some((s) => s.includes("response_window_expires_at = $4"))).toBe(false);
  });

  it("real dial: stamps the attempt, records the conversation, opens the windows", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dialRow()] });
    mockPlaceOutboundCall.mockResolvedValueOnce({
      dryRun: false,
      ok: true,
      conversationId: "conv_outbound_001",
      callSid: "CA123",
    });

    const result = await dialQueueItem({ queueId: QUEUE_ID, actorId: ACTOR_ID, now: NOW_CALLABLE });
    expect(result).toEqual({ placed: true, dryRun: false, conversationId: "conv_outbound_001" });

    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_OUTBOUND_ATTEMPTED",
        payload: expect.objectContaining({ dryRun: false, conversationId: "conv_outbound_001" }),
      })
    );

    const windowsUpdate = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("response_window_expires_at = $4")
    )!;
    expect(windowsUpdate).toBeDefined();
    // attempts 0 → 1; status → contacted.
    expect(windowsUpdate[1][0]).toBe(1);
    expect(String(windowsUpdate[0])).toContain("SET status = 'contacted'");
  });

  it("upstream failure marks the queue row failed and frees the entry", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [dialRow()] });
    mockPlaceOutboundCall.mockResolvedValueOnce({
      dryRun: false,
      ok: false,
      conversationId: null,
      callSid: null,
      error: "upstream_500",
    });

    const result = await dialQueueItem({ queueId: QUEUE_ID, actorId: ACTOR_ID, now: NOW_CALLABLE });
    expect(result).toEqual({ placed: false, refused: "dial_failed", error: "upstream_500" });
    expect(sqlCalls().some((s) => s.includes("SET status = 'failed'"))).toBe(true);
    expect(
      sqlCalls().some((s) => s.includes("CASE WHEN contact_attempts > 0 THEN 'contacted' ELSE 'pending'"))
    ).toBe(true);
  });
});
