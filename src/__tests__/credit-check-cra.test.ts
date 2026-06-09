/**
 * Consumer-report CRA adapter — TransUnion ShareAble credit lifecycle unit tests.
 *
 * Covers:
 *   - mapShareAbleReportToResponse(): pure, table-driven; categorical/integer-only
 *     output; eviction + bankruptcy counts; score + payment-history derivation.
 *   - resolve(): reads the webhook-persisted verdict; could_not_screen HOLD when
 *     no report / pending / wrong shape / lookup throws; re-runs evaluateResults.
 *   - createReport(): fail-loud throw until credentialing exists.
 *
 * No network / no real DB: ../config/database query is mocked.
 */

const mockQuery = jest.fn();

jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { CreditCheckService } from "../modules/screening/credit-check";

describe("CreditCheckService — TransUnion ShareAble CRA mapping", () => {
  let svc: CreditCheckService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new CreditCheckService();
  });

  describe("mapShareAbleReportToResponse", () => {
    it("strong score, no public records → score + good/excellent history, zero counts", () => {
      const r = svc.mapShareAbleReportToResponse({
        creditScore: 720,
        evictions: [],
        bankruptcies: [],
        collections: [],
      });
      expect(r.creditScore).toBe(720);
      expect(r.evictions).toBe(0);
      expect(r.bankruptcies).toBe(0);
      expect(r.collections).toBe(0);
      expect(r.paymentHistory).toBe("excellent");
    });

    it("eviction records → eviction COUNT (not the records themselves)", () => {
      const r = svc.mapShareAbleReportToResponse({
        score: 640,
        evictions: [{ filedOn: "2023-01-01" }, { filedOn: "2024-02-02" }],
      });
      expect(r.evictions).toBe(2);
    });

    it("bankruptcy + collection counts from arrays or integers", () => {
      const fromArrays = svc.mapShareAbleReportToResponse({
        score: 600,
        bankruptcies: [{ chapter: 7 }],
        collections: [{ amount: 100 }, { amount: 200 }],
      });
      expect(fromArrays.bankruptcies).toBe(1);
      expect(fromArrays.collections).toBe(2);

      const fromInts = svc.mapShareAbleReportToResponse({
        score: 600,
        bankruptcies: 2,
        collections: 1,
      });
      expect(fromInts.bankruptcies).toBe(2);
      expect(fromInts.collections).toBe(1);
    });

    it("missing score → 0 and unknown history (HOLD-leaning, never fabricated pass)", () => {
      const r = svc.mapShareAbleReportToResponse({});
      expect(r.creditScore).toBe(0);
      expect(r.paymentHistory).toBe("unknown");
    });

    it("explicit paymentHistory passes through; otherwise derived from score", () => {
      expect(svc.mapShareAbleReportToResponse({ score: 700, paymentHistory: "fair" }).paymentHistory).toBe("fair");
      expect(svc.mapShareAbleReportToResponse({ score: 670 }).paymentHistory).toBe("good");
      expect(svc.mapShareAbleReportToResponse({ score: 610 }).paymentHistory).toBe("fair");
      expect(svc.mapShareAbleReportToResponse({ score: 540 }).paymentHistory).toBe("poor");
    });

    it("never throws on malformed / empty input", () => {
      expect(() => svc.mapShareAbleReportToResponse(undefined)).not.toThrow();
      expect(() => svc.mapShareAbleReportToResponse(null)).not.toThrow();
    });

    it("output carries only categorical/integer fields — no tradeline detail", () => {
      const r: any = svc.mapShareAbleReportToResponse({
        score: 700,
        tradelines: [{ creditor: "Big Bank", account: "****1234", balance: 5000 }],
        evictions: [{ landlord: "Acme Properties", address: "123 Main St" }],
      });
      expect(r.tradelines).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain("Big Bank");
      expect(JSON.stringify(r)).not.toContain("123 Main St");
      expect(r.evictions).toBe(1); // count only
      expect(Object.keys(r).sort()).toEqual(
        ["bankruptcies", "collections", "creditScore", "evictions", "outstandingDebts", "paymentHistory"].sort()
      );
    });
  });

  describe("resolve", () => {
    it("no report on file → could_not_screen HOLD", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ credit_report_id: null }] });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
      expect(r.creditScore).toBe(0);
    });

    it("report still pending → could_not_screen HOLD", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ credit_report_id: "tu_1", credit_check_completed_at: null }],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
    });

    it("persisted strong verdict → pass", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            credit_report_id: "tu_1",
            credit_check_completed_at: new Date(),
            credit_check_details: {
              reportId: "tu_1",
              rawResponse: { creditScore: 720, paymentHistory: "excellent", outstandingDebts: 1000, collections: 0, evictions: 0, bankruptcies: 0 },
            },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("pass");
      expect(r.creditScore).toBe(720);
    });

    it("persisted eviction → fail (auto-fail on eviction)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            credit_report_id: "tu_1",
            credit_check_completed_at: new Date(),
            credit_check_details: {
              rawResponse: { creditScore: 700, evictions: 1, bankruptcies: 0, collections: 0 },
            },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("fail");
    });

    it("malformed persisted detail → could_not_screen HOLD", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            credit_report_id: "tu_1",
            credit_check_completed_at: new Date(),
            credit_check_details: { reportId: "tu_1" },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
    });

    it("DB lookup throws → could_not_screen HOLD (never a pass)", async () => {
      mockQuery.mockRejectedValueOnce(new Error("timeout"));
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
    });
  });

  describe("createReport", () => {
    it("throws (fail-loud) until ShareAble credentialing exists", async () => {
      await expect(
        svc.createReport({
          applicationId: "app-1",
          firstName: "Sam",
          lastName: "Lee",
          ssnLast4: "6789",
          dateOfBirth: "1990-01-01",
        })
      ).rejects.toThrow(/not yet configured/i);
    });

    it("isConfigured() is false until the ShareAble adapter is implemented (#273)", () => {
      // Credit is never configured on this branch — submit()'s readiness preflight
      // depends on this so it never half-arms (Checkr order with no credit order).
      expect(svc.isConfigured()).toBe(false);
    });
  });
});
