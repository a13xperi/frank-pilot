/**
 * Tests for src/modules/screening/fraud-detection.ts
 *
 * Covers duplicate SSN detection, income mismatch flagging,
 * and unusual approval speed detection.
 *
 * Compliance note: FCRA §604 requires reasonable procedures to ensure
 * accuracy. Fraud flagging must be auditable and proportional.
 */

import { FraudDetectionService } from "../modules/screening/fraud-detection";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({
  query: jest.fn(),
}));

jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn(),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const emptyRows = { rows: [] };

function makeApplicationRows(minutesToApprove: number | null) {
  return {
    rows: [
      {
        submitted_at: new Date(),
        tier1_decided_at: minutesToApprove !== null ? new Date() : null,
        minutes_to_approve: minutesToApprove,
      },
    ],
  };
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("FraudDetectionService", () => {
  let service: FraudDetectionService;

  beforeEach(() => {
    service = new FraudDetectionService();
    jest.clearAllMocks();
  });

  // ── checkDuplicateSSN ─────────────────────────────────────────────────────

  describe("checkDuplicateSSN", () => {
    it("returns isDuplicate=true with existing IDs when duplicates found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "app-001" }, { id: "app-002" }],
      } as any);

      const result = await service.checkDuplicateSSN("hash-abc");

      expect(result.isDuplicate).toBe(true);
      expect(result.existingApplicationIds).toEqual(["app-001", "app-002"]);
    });

    it("returns isDuplicate=false with empty array when no duplicates", async () => {
      mockQuery.mockResolvedValueOnce(emptyRows as any);

      const result = await service.checkDuplicateSSN("hash-unique");

      expect(result.isDuplicate).toBe(false);
      expect(result.existingApplicationIds).toEqual([]);
    });

    it("passes the ssn_hash to the query", async () => {
      mockQuery.mockResolvedValueOnce(emptyRows as any);

      await service.checkDuplicateSSN("my-hash-value");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ssn_hash"),
        ["my-hash-value"]
      );
    });

    it("excludes cancelled applications from duplicate check", async () => {
      mockQuery.mockResolvedValueOnce(emptyRows as any);

      await service.checkDuplicateSSN("hash-xyz");

      const sql: string = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/NOT IN.*cancelled/i);
    });
  });

  // ── checkIncomeMismatch ───────────────────────────────────────────────────

  describe("checkIncomeMismatch", () => {
    it("returns false and does NOT insert a flag when discrepancy < 15%", async () => {
      const flagged = await service.checkIncomeMismatch("app-1", 50000, 48000); // 4% diff

      expect(flagged).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it("returns false when discrepancy equals exactly 15% (boundary)", async () => {
      // 15% of 50000 = 7500 → verified = 42500 → discrepancy exactly 0.15
      const flagged = await service.checkIncomeMismatch("app-1", 50000, 42500);

      // 0.15 is NOT > 0.15, so no flag
      expect(flagged).toBe(false);
    });

    it("inserts medium severity flag when discrepancy is between 15% and 30%", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any); // INSERT
      mockAuditLog.mockResolvedValueOnce(undefined);

      // 20% discrepancy: 50000 vs 40000
      const flagged = await service.checkIncomeMismatch("app-2", 50000, 40000);

      expect(flagged).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
      expect(insertArgs).toContain("medium");
    });

    it("inserts high severity flag when discrepancy exceeds 30%", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      mockAuditLog.mockResolvedValueOnce(undefined);

      // 40% discrepancy: 50000 vs 30000
      const flagged = await service.checkIncomeMismatch("app-3", 50000, 30000);

      expect(flagged).toBe(true);

      const insertArgs = mockQuery.mock.calls[0][1] as unknown[];
      expect(insertArgs).toContain("high");
    });

    it("writes audit log when a flag is raised", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);
      mockAuditLog.mockResolvedValueOnce(undefined);

      await service.checkIncomeMismatch("app-4", 50000, 30000);

      expect(mockAuditLog).toHaveBeenCalledTimes(1);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "fraud_flag_raised",
          applicationId: "app-4",
        })
      );
    });
  });

  // ── checkApprovalSpeed ────────────────────────────────────────────────────

  describe("checkApprovalSpeed", () => {
    it("returns false when application is not found", async () => {
      mockQuery.mockResolvedValueOnce(emptyRows as any);

      const flagged = await service.checkApprovalSpeed("app-missing");

      expect(flagged).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("returns false when approval took >= 5 minutes (no anomaly)", async () => {
      mockQuery.mockResolvedValueOnce(makeApplicationRows(10) as any);

      const flagged = await service.checkApprovalSpeed("app-slow");

      expect(flagged).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1); // only SELECT, no INSERT
    });

    it("returns false when approval took exactly 5 minutes (boundary — not anomalous)", async () => {
      mockQuery.mockResolvedValueOnce(makeApplicationRows(5) as any);

      const flagged = await service.checkApprovalSpeed("app-exact");

      expect(flagged).toBe(false);
    });

    it("flags and returns true when approval took < 5 minutes", async () => {
      mockQuery
        .mockResolvedValueOnce(makeApplicationRows(2.5) as any) // SELECT
        .mockResolvedValueOnce({ rows: [] } as any);            // INSERT fraud_flag
      mockAuditLog.mockResolvedValueOnce(undefined);

      const flagged = await service.checkApprovalSpeed("app-fast");

      expect(flagged).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it("writes audit log when unusually fast approval is detected", async () => {
      mockQuery
        .mockResolvedValueOnce(makeApplicationRows(1) as any)
        .mockResolvedValueOnce({ rows: [] } as any);
      mockAuditLog.mockResolvedValueOnce(undefined);

      await service.checkApprovalSpeed("app-rushed");

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "fraud_flag_raised",
          applicationId: "app-rushed",
        })
      );
    });

    it("returns false when minutes_to_approve is null (no decision yet)", async () => {
      mockQuery.mockResolvedValueOnce(makeApplicationRows(null) as any);

      const flagged = await service.checkApprovalSpeed("app-pending");

      expect(flagged).toBe(false);
    });
  });
});
