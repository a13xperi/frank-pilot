/**
 * Tests for src/modules/voice-verification/service.ts — the mint/verify/lookup/
 * redact-history logic behind the Phase 2 in-call tools.
 *
 * The DB is fully mocked (no real DB, no real SMS — Twilio is not touched here).
 * We exercise:
 *   - mintCode shape (4 numeric digits, zero-padded)
 *   - issueCode stores a HASH, never the raw code
 *   - verifyCode: match / mismatch / expiry / attempts-cap / no-code / idempotent
 *   - isConversationVerified
 *   - resolveApplicant priority (applicant_id > email > phone)
 *   - summarizeHistory REDACTION (topic phrases from KEYS, never values)
 */

import crypto from "crypto";

const mockQuery = jest.fn();
jest.mock("../config/database", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import {
  mintCode,
  maskPhone,
  issueCode,
  verifyCode,
  isConversationVerified,
  resolveApplicant,
  summarizeHistory,
  __test,
} from "../modules/voice-verification/service";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("mintCode", () => {
  it("returns a 4-digit zero-padded numeric string", () => {
    for (let i = 0; i < 200; i++) {
      const c = mintCode();
      expect(c).toMatch(/^\d{4}$/);
    }
  });
});

describe("maskPhone", () => {
  it("shows only the last 4 digits", () => {
    expect(maskPhone("+17025554651")).toBe("***4651");
    expect(maskPhone(null)).toBe("****");
    expect(maskPhone("123")).toBe("****");
  });
});

describe("issueCode", () => {
  it("stores a HASH of the code (never the raw code) and returns the raw code", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "vvc-1" }] });

    const { code, id } = await issueCode({
      conversationId: "conv_1",
      phone: "+17025554651",
      applicantId: "app-1",
    });

    expect(code).toMatch(/^\d{4}$/);
    expect(id).toBe("vvc-1");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO voice_verification_codes/);
    // params: [conversation_id, code_hash, phone, applicant_id, expires_at]
    expect(params[0]).toBe("conv_1");
    expect(params[1]).toBe(sha256(code)); // HASH stored, not the raw code
    expect(params[1]).not.toBe(code);
    expect(params[2]).toBe("+17025554651");
    expect(params[3]).toBe("app-1");
    expect(params[4]).toBeInstanceOf(Date);
    // TTL ~10 min in the future
    const ms = (params[4] as Date).getTime() - Date.now();
    expect(ms).toBeGreaterThan(9 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });
});

describe("verifyCode", () => {
  const future = () => new Date(Date.now() + 5 * 60 * 1000);
  const past = () => new Date(Date.now() - 60 * 1000);

  it("returns 'no_code' when no row exists for the conversation", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await verifyCode("conv_x", "4729")).toBe("no_code");
  });

  it("verifies a correct read-back code and stamps used_at + verified_at", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "vvc-1",
            code_hash: sha256("4729"),
            expires_at: future(),
            used_at: null,
            verified_at: null,
            attempts: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // attempts++
      .mockResolvedValueOnce({ rows: [] }); // used_at/verified_at

    expect(await verifyCode("conv_1", "4729")).toBe("verified");

    // attempts bumped
    expect(mockQuery.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/);
    // verified + used stamped
    expect(mockQuery.mock.calls[2][0]).toMatch(/used_at = NOW\(\), verified_at = NOW\(\)/);
  });

  it("tolerates spoken formatting in the read-back ('4-7-2-9')", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "vvc-1",
            code_hash: sha256("4729"),
            expires_at: future(),
            used_at: null,
            verified_at: null,
            attempts: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    expect(await verifyCode("conv_1", "4-7-2-9")).toBe("verified");
  });

  it("returns 'mismatch' on a wrong code and does NOT stamp verified", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "vvc-1",
            code_hash: sha256("4729"),
            expires_at: future(),
            used_at: null,
            verified_at: null,
            attempts: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // attempts++

    expect(await verifyCode("conv_1", "4321")).toBe("mismatch");
    // only the SELECT + attempts-bump fired; no verify UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/);
  });

  it("returns 'expired' for a code past its TTL (attempt still counted)", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "vvc-1",
            code_hash: sha256("4729"),
            expires_at: past(),
            used_at: null,
            verified_at: null,
            attempts: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    expect(await verifyCode("conv_1", "4729")).toBe("expired");
    expect(mockQuery.mock.calls[1][0]).toMatch(/attempts = attempts \+ 1/);
  });

  it("returns 'too_many_attempts' once the attempts cap is hit (no further bump)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "vvc-1",
          code_hash: sha256("4729"),
          expires_at: future(),
          used_at: null,
          verified_at: null,
          attempts: __test.MAX_VERIFY_ATTEMPTS,
        },
      ],
    });

    expect(await verifyCode("conv_1", "4729")).toBe("too_many_attempts");
    // only the SELECT fired — no attempts bump past the cap
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("is idempotent on an already-verified row (returns 'verified', no writes)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "vvc-1",
          code_hash: sha256("4729"),
          expires_at: future(),
          used_at: new Date(),
          verified_at: new Date(),
          attempts: 1,
        },
      ],
    });

    expect(await verifyCode("conv_1", "anything")).toBe("verified");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("isConversationVerified", () => {
  it("true when a verified_at row exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    expect(await isConversationVerified("conv_1")).toBe(true);
  });
  it("false when none", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isConversationVerified("conv_1")).toBe(false);
  });
});

describe("resolveApplicant", () => {
  it("prefers applicant_id and short-circuits before email/phone", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "app-1", status: "submitted", email: "m@x.test" }],
    });

    const r = await resolveApplicant({
      applicantId: "app-1",
      email: "other@x.test",
      phone: "+1702",
    });
    expect(r).toEqual({ id: "app-1", status: "submitted", email: "m@x.test" });
    // only the id lookup ran
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(["app-1"]);
  });

  it("falls through to phone when id + email miss", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // id miss
      .mockResolvedValueOnce({ rows: [] }) // email miss
      .mockResolvedValueOnce({
        rows: [{ id: "app-9", status: "approved", email: null }],
      });

    const r = await resolveApplicant({
      applicantId: "missing",
      email: "no@x.test",
      phone: "+17025554651",
    });
    expect(r).toEqual({ id: "app-9", status: "approved", email: null });
    expect(mockQuery.mock.calls[2][1]).toEqual(["+17025554651"]);
  });

  it("returns null when nothing resolves", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await resolveApplicant({ phone: "+1702" })).toBeNull();
  });
});

describe("summarizeHistory — redaction", () => {
  it("derives topic phrases from KEYS only, never field values", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          started_at: new Date("2026-06-10T17:00:00Z"),
          // values carry PII that must NEVER surface in the summary
          data_collection_results: {
            first_name: "Marcus",
            annual_income: "84000",
            move_in_date: "2026-08-01",
          },
        },
      ],
    });

    const h = await summarizeHistory("app-1", "submitted");
    expect(h.found).toBe(true);
    expect(h.lastContact).toBe("2026-06-10");
    // topic labels present
    expect(h.summary).toMatch(/your name/);
    expect(h.summary).toMatch(/income/);
    expect(h.summary).toMatch(/move-in timing/);
    // RAW VALUES must not leak
    expect(h.summary).not.toContain("Marcus");
    expect(h.summary).not.toContain("84000");
    expect(h.summary).not.toContain("2026-08-01");
    // status humanized + appended
    expect(h.summary).toMatch(/currently submitted/);
  });

  it("handles a resolved applicant with no prior calls", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const h = await summarizeHistory("app-1", "approved");
    expect(h.found).toBe(true);
    expect(h.lastContact).toBeNull();
    expect(h.summary).toMatch(/currently approved/);
  });

  it("found=false with no status and no calls", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const h = await summarizeHistory("app-1", null);
    expect(h.found).toBe(false);
    expect(h.lastContact).toBeNull();
  });

  it("collectTopics caps at 3 and ignores unknown keys", () => {
    const topics = __test.collectTopics([
      { first_name: 1, last_name: 1, phone: 1, income: 1, weird_unknown_key: 1 },
    ]);
    expect(topics.length).toBeLessThanOrEqual(3);
    expect(topics).not.toContain("weird_unknown_key");
  });
});
