/**
 * Unit tests for src/modules/screening/consumer-report-consent.ts — the FCRA
 * §1681b consumer-report authorization capture.
 *
 * Mocked: query (../config/database), writeAuditLog (../middleware/audit).
 * Everything else is the real module so the disclosure text/hash, idempotency,
 * and stale-version guard are exercised for real.
 */

import { createHash } from "crypto";
import type { QueryResult } from "pg";
import {
  FCRA_DISCLOSURE_VERSION,
  FCRA_DISCLOSURE_TEXT,
  fcraDisclosureHash,
  getDisclosure,
  getAuthorization,
  hasValidAuthorization,
  recordAuthorization,
  verifyStoredAuthorization,
  findDisclosureEvidence,
  verifyVoiceAuthorizationForConversation,
  METHOD_VOICE_VERBAL_UNVERIFIED,
  METHOD_VOICE_VERBAL_VERIFIED,
} from "../modules/screening/consumer-report-consent";
import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

function qr<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return { rows } as unknown as QueryResult<T>;
}

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

beforeEach(() => {
  mockQuery.mockReset();
  mockWriteAuditLog.mockReset();
  mockWriteAuditLog.mockResolvedValue(undefined);
});

describe("disclosure", () => {
  it("serves a stable version + the canonical text + its SHA-256 hash", () => {
    const d = getDisclosure();
    expect(d.version).toBe(FCRA_DISCLOSURE_VERSION);
    expect(d.text).toBe(FCRA_DISCLOSURE_TEXT);
    // Hash is independently reproducible from the exact text shown.
    const expected = createHash("sha256").update(FCRA_DISCLOSURE_TEXT).digest("hex");
    expect(d.hash).toBe(expected);
  });

  it("hashing is deterministic", () => {
    expect(fcraDisclosureHash()).toBe(fcraDisclosureHash());
  });

  it("disclosure text names the FCRA permissible purpose and the right to dispute", () => {
    expect(FCRA_DISCLOSURE_TEXT).toMatch(/Fair Credit Reporting Act/i);
    expect(FCRA_DISCLOSURE_TEXT).toMatch(/dispute/i);
    expect(FCRA_DISCLOSURE_TEXT).toMatch(/authorize/i);
  });
});

describe("recordAuthorization", () => {
  it("inserts the authorization and writes a consumer_report_authorized audit (new capture)", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([{ authorized_at: new Date("2026-06-01T10:00:00.000Z") }])
    );

    const result = await recordAuthorization({
      applicationId: "app-1",
      applicantId: "u1",
      applicantRole: "applicant",
      ip: "1.2.3.4",
      userAgent: "UA/1.0",
    });

    expect(result).toEqual({
      authorizedAt: "2026-06-01T10:00:00.000Z",
      alreadyRecorded: false,
    });

    // INSERT ... ON CONFLICT DO NOTHING persists the version, the text hash, AND
    // the exact disclosure text whose hash it is.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO consumer_report_authorizations/i);
    expect(sql).toMatch(/disclosure_text/i);
    expect(sql).toMatch(/ON CONFLICT \(application_id\) DO NOTHING/i);
    expect(params).toEqual([
      "app-1",
      "u1",
      "applicant",
      FCRA_DISCLOSURE_VERSION,
      fcraDisclosureHash(),
      FCRA_DISCLOSURE_TEXT,
      "in_app_checkbox",
      "1.2.3.4",
      "UA/1.0",
      null, // conversation_id — only voice methods anchor to a conversation
    ]);
    // The retained text hashes to the recorded hash — self-provable.
    expect(fcraDisclosureHash(params![5] as string)).toBe(params![4]);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "consumer_report_authorized",
        actorId: "u1",
        actorRole: "applicant",
        applicationId: "app-1",
        ipAddress: "1.2.3.4",
        userAgent: "UA/1.0",
        details: expect.objectContaining({
          disclosureVersion: FCRA_DISCLOSURE_VERSION,
          method: "in_app_checkbox",
        }),
      })
    );
  });

  it("is idempotent: a conflict returns the FIRST authorizedAt and writes no second audit", async () => {
    // INSERT RETURNING comes back empty (ON CONFLICT DO NOTHING)...
    mockQuery.mockResolvedValueOnce(qr([]));
    // ...then getAuthorization reads the pre-existing row.
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          application_id: "app-1",
          applicant_id: "u1",
          disclosure_version: FCRA_DISCLOSURE_VERSION,
          disclosure_hash: fcraDisclosureHash(),
          disclosure_text: FCRA_DISCLOSURE_TEXT,
          method: "in_app_checkbox",
          authorized_at: new Date("2026-05-30T09:00:00.000Z"),
        },
      ])
    );

    const result = await recordAuthorization({
      applicationId: "app-1",
      applicantId: "u-different",
      applicantRole: "applicant",
    });

    expect(result).toEqual({
      authorizedAt: "2026-05-30T09:00:00.000Z",
      alreadyRecorded: true,
    });
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a stale disclosure version fail-loud (no insert, no audit)", async () => {
    await expect(
      recordAuthorization({ applicationId: "app-1", disclosureVersion: "2020-01-01" })
    ).rejects.toThrow(/stale/i);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

describe("hasValidAuthorization", () => {
  it("true when a record exists against the current disclosure version", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          application_id: "app-1",
          applicant_id: "u1",
          disclosure_version: FCRA_DISCLOSURE_VERSION,
          disclosure_hash: fcraDisclosureHash(),
          method: "in_app_checkbox",
          authorized_at: new Date("2026-06-01T10:00:00.000Z"),
        },
      ])
    );
    await expect(hasValidAuthorization("app-1")).resolves.toBe(true);
  });

  it("false when the recorded authorization is against a superseded version", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          application_id: "app-1",
          applicant_id: "u1",
          disclosure_version: "2020-01-01",
          disclosure_hash: "old",
          method: "in_app_checkbox",
          authorized_at: new Date("2020-01-01T00:00:00.000Z"),
        },
      ])
    );
    await expect(hasValidAuthorization("app-1")).resolves.toBe(false);
  });

  it("false when no authorization exists", async () => {
    mockQuery.mockResolvedValue(qr([])); // both hasValid + getAuthorization read empty
    await expect(hasValidAuthorization("app-1")).resolves.toBe(false);
    await expect(getAuthorization("app-1")).resolves.toBeNull();
  });
});

describe("verifyStoredAuthorization", () => {
  it("intact for a current-version authorization (retained text re-hashes to recorded hash)", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          application_id: "app-1",
          applicant_id: "u1",
          disclosure_version: FCRA_DISCLOSURE_VERSION,
          disclosure_hash: fcraDisclosureHash(),
          disclosure_text: FCRA_DISCLOSURE_TEXT,
          method: "in_app_checkbox",
          authorized_at: new Date("2026-06-01T10:00:00.000Z"),
        },
      ])
    );
    await expect(verifyStoredAuthorization("app-1")).resolves.toEqual({
      found: true,
      intact: true,
    });
  });

  it("intact for a SUPERSEDED version whose text is gone from source — the retention guarantee", async () => {
    // Simulate an authorization captured before a wording bump: the disclosure
    // text below no longer matches the current FCRA_DISCLOSURE_TEXT constant, so
    // it cannot be reconstructed from source. Because the exact text is RETAINED
    // on the row, its recorded hash is still pre-imageable — closing the gap.
    const oldText =
      "CONSUMER REPORT AUTHORIZATION (v2024)\n\nSuperseded disclosure wording that " +
      "no longer exists anywhere in the current source tree.";
    const oldHash = createHash("sha256").update(oldText).digest("hex");
    expect(oldText).not.toBe(FCRA_DISCLOSURE_TEXT);
    expect(oldHash).not.toBe(fcraDisclosureHash());

    mockQuery.mockResolvedValueOnce(
      qr([
        {
          application_id: "app-old",
          applicant_id: "u1",
          disclosure_version: "2024-01-01",
          disclosure_hash: oldHash,
          disclosure_text: oldText,
          method: "in_app_checkbox",
          authorized_at: new Date("2024-01-01T00:00:00.000Z"),
        },
      ])
    );
    await expect(verifyStoredAuthorization("app-old")).resolves.toEqual({
      found: true,
      intact: true,
    });
  });

  it("not intact when the retained text and recorded hash disagree (tamper/corruption)", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([
        {
          application_id: "app-1",
          applicant_id: "u1",
          disclosure_version: FCRA_DISCLOSURE_VERSION,
          disclosure_hash: fcraDisclosureHash(), // hash of the canonical text...
          disclosure_text: FCRA_DISCLOSURE_TEXT + "\nTAMPERED LINE", // ...but text differs
          method: "in_app_checkbox",
          authorized_at: new Date("2026-06-01T10:00:00.000Z"),
        },
      ])
    );
    await expect(verifyStoredAuthorization("app-1")).resolves.toEqual({
      found: true,
      intact: false,
    });
  });

  it("found:false / intact:false when there is no authorization to verify", async () => {
    mockQuery.mockResolvedValueOnce(qr([]));
    await expect(verifyStoredAuthorization("app-1")).resolves.toEqual({
      found: false,
      intact: false,
    });
  });
});

// ─── Audit C4: voice consent evidence ────────────────────────────────────────

describe("recordAuthorization — voice method anchors the conversation", () => {
  it("persists conversation_id and the unverified method for a voice-minted authorization", async () => {
    mockQuery.mockResolvedValueOnce(
      qr([{ authorized_at: new Date("2026-07-02T10:00:00.000Z") }])
    );

    await recordAuthorization({
      applicationId: "app-1",
      applicantId: "u1",
      applicantRole: "applicant",
      method: METHOD_VOICE_VERBAL_UNVERIFIED,
      conversationId: "conv_voice_1",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params![6]).toBe(METHOD_VOICE_VERBAL_UNVERIFIED);
    expect(params![9]).toBe("conv_voice_1");
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          method: METHOD_VOICE_VERBAL_UNVERIFIED,
          conversationId: "conv_voice_1",
        }),
      })
    );
  });
});

describe("findDisclosureEvidence", () => {
  const DISCLOSURE_TURN = {
    role: "agent",
    message:
      "Before I run this I need your OK: we'll pull a background check and a credit report through our screening agencies to evaluate your application. Do you authorize that?",
  };

  it("finds the read disclosure followed by the caller's affirmative", () => {
    const evidence = findDisclosureEvidence([
      { role: "agent", message: "Great, let's get your application going." },
      DISCLOSURE_TURN,
      { role: "user", message: "Yes, that's fine, go ahead." },
    ]);
    expect(evidence.found).toBe(true);
    expect(evidence.agentTurn).toBe(1);
    expect(evidence.userTurn).toBe(2);
    expect(evidence.agentSnippet).toMatch(/background check and a credit report/);
    expect(evidence.userSnippet).toMatch(/Yes/);
  });

  it("does not match when no disclosure was read (agent never named the reports)", () => {
    const evidence = findDisclosureEvidence([
      { role: "agent", message: "Ready to pay the fee?" },
      { role: "user", message: "Yes." },
    ]);
    expect(evidence.found).toBe(false);
  });

  it("does not match when the caller declined the disclosure", () => {
    const evidence = findDisclosureEvidence([
      DISCLOSURE_TURN,
      { role: "user", message: "No, I don't want that." },
      { role: "user", message: "Actually yes to the apartment tour though." },
    ]);
    expect(evidence.found).toBe(false);
  });

  it("an affirmative BEFORE the disclosure is not evidence", () => {
    const evidence = findDisclosureEvidence([
      { role: "user", message: "Yes yes yes." },
      DISCLOSURE_TURN,
    ]);
    expect(evidence.found).toBe(false);
  });

  it("pii-filters the stored snippets", () => {
    const evidence = findDisclosureEvidence([
      DISCLOSURE_TURN,
      { role: "user", message: "Yes — and my social is 123-45-6789 by the way." },
    ]);
    expect(evidence.found).toBe(true);
    expect(evidence.userSnippet).not.toContain("123-45-6789");
    expect(evidence.userSnippet).toContain("[SSN-REDACTED]");
  });
});

describe("verifyVoiceAuthorizationForConversation", () => {
  const TRANSCRIPT = [
    {
      role: "agent",
      message:
        "We'll run a background check and credit report through our screening agencies. Do you authorize that?",
    },
    { role: "user", message: "Yes, I authorize it." },
  ];

  it("upgrades an unverified voice authorization when the transcript shows disclosure + affirmative", async () => {
    mockQuery
      .mockResolvedValueOnce(qr([{ application_id: "app-1" }])) // pending lookup
      .mockResolvedValueOnce(qr([{ application_id: "app-1" }])); // UPDATE ... RETURNING

    const result = await verifyVoiceAuthorizationForConversation("conv_1", TRANSCRIPT);

    expect(result).toEqual({ checked: 1, verified: 1 });
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE consumer_report_authorizations/i);
    expect(updateSql).toMatch(/verified_at = NOW\(\)/i);
    expect(updateParams![0]).toBe("conv_1");
    expect(updateParams![1]).toBe(METHOD_VOICE_VERBAL_UNVERIFIED);
    expect(updateParams![2]).toBe(METHOD_VOICE_VERBAL_VERIFIED);
    const storedEvidence = JSON.parse(String(updateParams![3]));
    expect(storedEvidence.found).toBe(true);
    expect(storedEvidence.matcher).toBe("transcript-disclosure-v1");

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "consumer_report_consent_verified",
        applicationId: "app-1",
        details: expect.objectContaining({ conversationId: "conv_1" }),
      })
    );
  });

  it("leaves the row unverified (no UPDATE, no audit) when the transcript lacks evidence", async () => {
    mockQuery.mockResolvedValueOnce(qr([{ application_id: "app-1" }])); // pending lookup

    const result = await verifyVoiceAuthorizationForConversation("conv_1", [
      { role: "agent", message: "Want to schedule a tour?" },
      { role: "user", message: "Yes." },
    ]);

    expect(result).toEqual({ checked: 1, verified: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1); // lookup only — nothing rewritten
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it("no-ops when the conversation minted no unverified authorization (idempotent re-delivery)", async () => {
    mockQuery.mockResolvedValueOnce(qr([]));

    const result = await verifyVoiceAuthorizationForConversation("conv_1", TRANSCRIPT);

    expect(result).toEqual({ checked: 0, verified: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing transcript (post_call_audio delivery) — stays unverified", async () => {
    mockQuery.mockResolvedValueOnce(qr([{ application_id: "app-1" }]));

    const result = await verifyVoiceAuthorizationForConversation("conv_1", undefined);

    expect(result).toEqual({ checked: 1, verified: 0 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
