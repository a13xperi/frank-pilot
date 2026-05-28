/**
 * Unit tests for src/modules/voice-intake/service.ts.
 *
 * `persistConversation` is the upsert path the webhook calls — exercised here
 * directly so the shape of what lands in `voice_intake_calls` is locked in
 * (consent defaults, language slicing, callback flag parsing).
 *
 * `promoteIntakeToApplication` and `rejectIntake` are the PM-console review
 * actions — they're the moments the intake becomes a real `applications` row
 * (with a HUD-stamped audit anchor) or is closed out. Both are state
 * transitions worth pinning, and the SMS handoff is fire-and-forget so we
 * mock `sendMagicLinkSms` to assert the call vs the no-phone skip path.
 *
 * Database is fully mocked — these are unit tests on the SQL we issue and
 * the side-effects we emit, not integration tests against Postgres.
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

const mockSendMagicLinkSms = jest.fn();
jest.mock("../modules/auth/magic-link-service", () => ({
  sendMagicLinkSms: mockSendMagicLinkSms,
}));

import {
  persistConversation,
  promoteIntakeToApplication,
  rejectIntake,
  type PostCallPayload,
} from "../modules/voice-intake/service";

const flush = () => new Promise((resolve) => setImmediate(resolve));

const CALL_ROW_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const APP_ROW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTOR_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PROPERTY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

beforeEach(() => {
  jest.clearAllMocks();
});

// ── persistConversation ────────────────────────────────────────────────────

describe("persistConversation", () => {
  it("upserts a complete payload — language, callSuccessful, consent and callback flags all surfaced", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CALL_ROW_ID }] });

    const payload: PostCallPayload = {
      conversation_id: "conv_persist_001",
      agent_id: "agent_frank_v1",
      metadata: {
        start_time_unix_secs: 1_700_000_000,
        call_duration_secs: 120,
        detected_language: "en",
        main_language: "es",
        cost: { total: 0.034 },
      },
      analysis: {
        call_successful: "success",
        evaluation_criteria_results: { name: { result: "success" } },
        data_collection_results: {
          name: { value: "Jane Caller" },
          phone: { value: "(702) 555-0123" },
          current_city: { value: "Las Vegas" },
          consent_recording: { value: "true" },
          callback_requested: { value: "yes" },
        },
      },
      transcript_url: "https://api.elevenlabs.io/v1/convai/conversations/conv_persist_001/transcript",
      audio_url: "https://api.elevenlabs.io/v1/convai/conversations/conv_persist_001/audio",
    };

    const result = await persistConversation(payload);

    expect(result).toEqual({
      callId: CALL_ROW_ID,
      language: "en",
      callSuccessful: "success",
      consentRecording: true,
      callbackRequested: true,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO voice_intake_calls");
    expect(String(sql)).toContain("ON CONFLICT (conversation_id) DO UPDATE");
    // Positional params (see service.ts persistConversation):
    //   1 conversation_id, 2 agent_id, 3 startedAt, 4 endedAt, 5 language,
    //   6 callSuccessful, 7..8 jsonb, 9 transcript_url, 10 audio_url,
    //   11 cost_breakdown, 12 consent_recording, 13 callback_requested, 14 raw_payload
    expect(params[0]).toBe("conv_persist_001");
    expect(params[1]).toBe("agent_frank_v1");
    expect(params[3]).toBeInstanceOf(Date); // endedAt computed from start + duration
    expect(params[4]).toBe("en"); // detected_language wins over main_language
    expect(params[5]).toBe("success");
    expect(params[8]).toBe(payload.transcript_url);
    expect(params[9]).toBe(payload.audio_url);
    expect(params[11]).toBe(true);
    expect(params[12]).toBe(true);
  });

  it("defaults consent to TRUE when the caller never opted out (implied-consent path)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CALL_ROW_ID }] });

    const payload: PostCallPayload = {
      conversation_id: "conv_no_consent_field",
      agent_id: "agent_frank_v1",
      analysis: { data_collection_results: { name: { value: "Anon" } } },
    };

    const result = await persistConversation(payload);
    expect(result.consentRecording).toBe(true);
    expect(result.callbackRequested).toBe(false);
  });

  it("respects an explicit consent_recording='false'", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CALL_ROW_ID }] });

    const payload: PostCallPayload = {
      conversation_id: "conv_explicit_no",
      agent_id: "agent_frank_v1",
      analysis: {
        data_collection_results: {
          consent_recording: { value: "false" },
        },
      },
    };

    const result = await persistConversation(payload);
    expect(result.consentRecording).toBe(false);
  });

  it("computes startedAt from now() when metadata.start_time_unix_secs is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CALL_ROW_ID }] });

    const before = Date.now();
    await persistConversation({
      conversation_id: "conv_no_start",
      agent_id: "agent_frank_v1",
    });
    const after = Date.now();

    const startedAt = mockQuery.mock.calls[0][1][2] as Date;
    expect(startedAt).toBeInstanceOf(Date);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(startedAt.getTime()).toBeLessThanOrEqual(after);

    // endedAt stays null when we can't compute it.
    expect(mockQuery.mock.calls[0][1][3]).toBeNull();
  });

  it("slices language and callSuccessful so DB VARCHAR limits can't be overrun", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CALL_ROW_ID }] });

    await persistConversation({
      conversation_id: "conv_long_strings",
      agent_id: "agent_frank_v1",
      metadata: { main_language: "en-US-extra-very-long-tag" },
      analysis: { call_successful: "wildly_overshot_status_string" },
    });

    const params = mockQuery.mock.calls[0][1];
    expect((params[4] as string).length).toBeLessThanOrEqual(8);
    expect((params[5] as string).length).toBeLessThanOrEqual(16);
  });
});

// ── promoteIntakeToApplication ─────────────────────────────────────────────

describe("promoteIntakeToApplication", () => {
  function arrangeCallLookup(opts: {
    data?: Record<string, unknown>;
    applicantId?: string | null;
    notFound?: boolean;
  } = {}) {
    if (opts.notFound) {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      return;
    }
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          data_collection_results: opts.data ?? {
            name: { value: "Jane Caller" },
            phone: { value: "(702) 555-0123" },
            current_city: { value: "Las Vegas" },
            household: { value: "3" },
            monthly_income: { value: "$2,500" },
          },
          applicant_id: opts.applicantId ?? null,
        },
      ],
    });
  }

  it("inserts an applications row with source='voice', back-references the call, stamps a HUD decision, and fires the SMS doc-upload handoff", async () => {
    arrangeCallLookup();
    // INSERT applications → returns applicationId
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ROW_ID }] });
    // UPDATE voice_intake_calls back-reference
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await promoteIntakeToApplication({
      callId: CALL_ROW_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_ID,
    });

    expect(result.applicationId).toBe(APP_ROW_ID);

    // INSERT applications has the right shape — source/voice_call_id/submitted_by.
    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO applications")
    );
    expect(insertCall).toBeDefined();
    const sql = String(insertCall![0]);
    expect(sql).toContain("source");
    expect(sql).toContain("voice_call_id");
    expect(sql).toContain("'voice'"); // source literal
    const params = insertCall![1];
    expect(params[0]).toBe(PROPERTY_ID);
    expect(params[1]).toBe("Jane"); // firstName
    expect(params[2]).toBe("Caller"); // lastName
    expect(params[3]).toBe("+17025550123"); // phone normalized
    expect(params[4]).toBe("Las Vegas");
    expect(params[5]).toBe(3); // household
    expect(params[6]).toBe(30000); // monthly * 12 ($2,500 × 12)
    expect(params[7]).toBe(CALL_ROW_ID); // voice_call_id
    expect(params[8]).toBe(ACTOR_ID); // submitted_by

    // Back-reference UPDATE wires applicant_id back onto the call row.
    const backRefCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE voice_intake_calls SET applicant_id")
    );
    expect(backRefCall).toBeDefined();
    expect(backRefCall![1]).toEqual([APP_ROW_ID, CALL_ROW_ID]);

    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_DECISION",
        actor: ACTOR_ID,
        sessionId: CALL_ROW_ID,
        payload: expect.objectContaining({
          callId: CALL_ROW_ID,
          applicationId: APP_ROW_ID,
          decision: "approved",
          propertyId: PROPERTY_ID,
        }),
      })
    );

    // SMS doc-upload handoff fired with normalized phone + apply link.
    expect(mockSendMagicLinkSms).toHaveBeenCalledTimes(1);
    const [phoneArg, linkArg] = mockSendMagicLinkSms.mock.calls[0];
    expect(phoneArg).toBe("+17025550123");
    expect(linkArg).toContain(`/apply/${APP_ROW_ID}/documents`);
  });

  it("throws with code ALREADY_PROMOTED when the call already has an applicant_id (idempotency guard)", async () => {
    arrangeCallLookup({ applicantId: "prior-applicant-row" });

    await expect(
      promoteIntakeToApplication({
        callId: CALL_ROW_ID,
        propertyId: PROPERTY_ID,
        actorId: ACTOR_ID,
      })
    ).rejects.toMatchObject({ code: "ALREADY_PROMOTED" });

    // No INSERT happened — only the lookup query ran.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockStampTape).not.toHaveBeenCalled();
    expect(mockSendMagicLinkSms).not.toHaveBeenCalled();
  });

  it("throws a plain Error when the call row is missing", async () => {
    arrangeCallLookup({ notFound: true });

    await expect(
      promoteIntakeToApplication({
        callId: CALL_ROW_ID,
        propertyId: PROPERTY_ID,
        actorId: ACTOR_ID,
      })
    ).rejects.toThrow(/not found/i);
  });

  it("skips the SMS doc-upload handoff (no throw) when no phone was captured", async () => {
    arrangeCallLookup({
      data: { name: { value: "No Phone" } },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ROW_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await promoteIntakeToApplication({
      callId: CALL_ROW_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_ID,
    });

    expect(result.applicationId).toBe(APP_ROW_ID);
    expect(mockSendMagicLinkSms).not.toHaveBeenCalled();
  });

  it("defaults to 'Unknown Caller' (first 'Unknown', last 'Caller') when no name was captured", async () => {
    arrangeCallLookup({ data: {} });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ROW_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await promoteIntakeToApplication({
      callId: CALL_ROW_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_ID,
    });

    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO applications")
    )!;
    expect(insertCall[1][1]).toBe("Unknown");
    expect(insertCall[1][2]).toBe("Caller");
  });

  it("falls back to '—' lastName when the captured name has no space (single-token)", async () => {
    arrangeCallLookup({
      data: { name: { value: "Madonna" } },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ROW_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await promoteIntakeToApplication({
      callId: CALL_ROW_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_ID,
    });

    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO applications")
    )!;
    expect(insertCall[1][1]).toBe("Madonna");
    expect(insertCall[1][2]).toBe("—");
  });

  it("treats an international phone (E.164) as-is rather than prepending +1", async () => {
    arrangeCallLookup({
      data: {
        name: { value: "Ana Inter" },
        phone: { value: "+4520123456" },
      },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: APP_ROW_ID }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await promoteIntakeToApplication({
      callId: CALL_ROW_ID,
      propertyId: PROPERTY_ID,
      actorId: ACTOR_ID,
    });

    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO applications")
    )!;
    expect(insertCall[1][3]).toBe("+4520123456");
  });
});

// ── rejectIntake ───────────────────────────────────────────────────────────

describe("rejectIntake", () => {
  it("stamps VOICE_INTAKE_DECISION with decision='rejected' + reason and soft-drops the row from the callback queue", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await rejectIntake({
      callId: CALL_ROW_ID,
      actorId: ACTOR_ID,
      reason: "Not the unit they wanted — caller asked for 3BR, we only have 1BR/2BR.",
    });

    expect(mockStampTape).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "VOICE_INTAKE_DECISION",
        actor: ACTOR_ID,
        sessionId: CALL_ROW_ID,
        payload: expect.objectContaining({
          callId: CALL_ROW_ID,
          decision: "rejected",
          reason: expect.stringContaining("3BR"),
        }),
      })
    );

    // Soft-reject: callback_requested := FALSE on the voice_intake_calls row.
    const updateCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE voice_intake_calls SET callback_requested = FALSE")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([CALL_ROW_ID]);

    // Tape stamp is fire-and-forget — let it settle to avoid flakiness.
    await flush();
  });
});
