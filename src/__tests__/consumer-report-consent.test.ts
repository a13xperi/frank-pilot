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

    // INSERT ... ON CONFLICT DO NOTHING with the current version + the text hash.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO consumer_report_authorizations/i);
    expect(sql).toMatch(/ON CONFLICT \(application_id\) DO NOTHING/i);
    expect(params).toEqual([
      "app-1",
      "u1",
      "applicant",
      FCRA_DISCLOSURE_VERSION,
      fcraDisclosureHash(),
      "in_app_checkbox",
      "1.2.3.4",
      "UA/1.0",
    ]);

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
