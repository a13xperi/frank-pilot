/**
 * Consumer-report CRA adapter — TransUnion ShareAble credit lifecycle unit tests.
 *
 * Covers:
 *   - mapShareAbleReportToResponse(): pure, table-driven; categorical/integer-only
 *     output; eviction + bankruptcy counts; score + payment-history derivation.
 *   - resolve(): reads the webhook-persisted verdict; could_not_screen HOLD when
 *     no report / pending / wrong shape / lookup throws; re-runs evaluateResults.
 *   - createReport(): keyless → fail-loud throw (no fabricated handle); keyed →
 *     real ShareAble applicant + screening-request flow over a mocked fetch.
 *
 * No network / no real DB: ../config/database query is mocked; the keyed
 * createReport tests mock global fetch.
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
    // Keep the keyless createReport contract test deterministic even if a sibling
    // test file in the same worker left the key set. The keyed describe re-sets it
    // in its own beforeEach (runs after this one).
    delete process.env.TRANSUNION_SHAREABLE_API_KEY;
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
        ["bankruptcies", "collections", "creditScore", "evictions", "indeterminate", "outstandingDebts", "paymentHistory"].sort()
      );
    });

    // ── Fail-closed guard (credentialing audit 2026-06-24): a good score must
    // not pass when public-records were present but unparseable, or status is
    // not actually clear. ─────────────────────────────────────────────────────
    it("good score but public-records under an UNRECOGNIZED key → indeterminate (no false-clean)", () => {
      const r = svc.mapShareAbleReportToResponse({
        creditScore: 720,
        // Real eviction filings under a key the mapper doesn't parse → count 0.
        publicRecords: { eviction_filings: [{ court: "Clark County" }] },
      });
      expect(r.evictions).toBe(0); // we failed to parse it...
      expect(r.bankruptcies).toBe(0);
      expect(r.indeterminate).toBe(true); // ...so it must NOT pass on the good score
    });

    it("non-clear report status → indeterminate", () => {
      const r = svc.mapShareAbleReportToResponse({ creditScore: 700, status: "pending" });
      expect(r.indeterminate).toBe(true);
    });

    it("genuinely clean report (explicitly empty public records) is NOT indeterminate", () => {
      const r = svc.mapShareAbleReportToResponse({
        creditScore: 720,
        status: "complete",
        publicRecords: { evictions: [], bankruptcies: [] },
        evictions: [],
        bankruptcies: [],
      });
      expect(r.indeterminate).toBe(false);
      expect(r.creditScore).toBe(720);
    });

    it("parsed eviction (recognized shape) is not indeterminate — the count drives the verdict", () => {
      const r = svc.mapShareAbleReportToResponse({ creditScore: 720, evictions: [{ landlord: "Acme" }] });
      expect(r.evictions).toBe(1);
      expect(r.indeterminate).toBe(false);
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

    it("persisted INDETERMINATE report → could_not_screen HOLD (good score does not pass)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            credit_report_id: "tu_1",
            credit_check_completed_at: new Date(),
            credit_check_details: {
              rawResponse: {
                creditScore: 720,
                paymentHistory: "excellent",
                outstandingDebts: 1000,
                collections: 0,
                evictions: 0,
                bankruptcies: 0,
                indeterminate: true,
              },
            },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
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
  });

  describe("isConfigured — readiness preflight predicate", () => {
    afterEach(() => {
      delete process.env.TRANSUNION_SHAREABLE_API_KEY;
    });
    it("false with no key (keyless ⇒ submit() refuses to fire a partial pull)", () => {
      delete process.env.TRANSUNION_SHAREABLE_API_KEY;
      expect(svc.isConfigured()).toBe(false);
    });
    it('false when the key is the "changeme" placeholder', () => {
      process.env.TRANSUNION_SHAREABLE_API_KEY = "changeme";
      expect(svc.isConfigured()).toBe(false);
    });
    it("true with a real key — lockstep with createReport()'s gate", () => {
      process.env.TRANSUNION_SHAREABLE_API_KEY = "tu_test_abc";
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe("createReport — keyed (real ShareAble two-step over mocked fetch)", () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      // Outer beforeEach deletes the key and runs FIRST; arm it here.
      process.env.TRANSUNION_SHAREABLE_API_KEY = "tu_test_abc";
      delete process.env.TRANSUNION_SHAREABLE_API_URL;
      delete process.env.TRANSUNION_SHAREABLE_PRODUCT_BUNDLE;
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });
    afterEach(() => {
      (global as any).fetch = realFetch;
      delete process.env.TRANSUNION_SHAREABLE_API_KEY;
    });

    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

    const input = {
      applicationId: "app-1",
      firstName: "Sam",
      lastName: "Lee",
      ssnLast4: "6789",
      dateOfBirth: "1990-01-01",
      email: "sam@example.com",
    };

    it("applicant → screening-request; returns request.id as the webhook join key", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ id: "appl_123" }))
        .mockResolvedValueOnce(
          ok({ id: "req_456", exam_url: "https://exam.shareable.com/x", status: "pending" })
        );

      const handle = await svc.createReport(input);

      // request.id is the durable join key (the report id does not exist yet).
      expect(handle.reportId).toBe("req_456");
      expect(handle.url).toBe("https://exam.shareable.com/x");
      expect(handle.status).toBe("pending");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [applUrl, applOpts] = fetchMock.mock.calls[0];
      expect(String(applUrl)).toMatch(/\/v1\/applicants$/);
      expect((applOpts.headers as any).Authorization).toBe("Bearer tu_test_abc");
      const applBody = JSON.parse(applOpts.body);
      expect(applBody.email).toBe("sam@example.com");
      expect(applBody.first_name).toBe("Sam");
      expect(applBody.date_of_birth).toBe("1990-01-01");
      // Full SSN / last-4 are NEVER sent — the hosted KBA exam collects it.
      expect(applBody.ssn).toBeUndefined();
      expect(applBody.ssn_last4).toBeUndefined();
      expect(JSON.stringify(applBody)).not.toContain("6789");

      const [reqUrl, reqOpts] = fetchMock.mock.calls[1];
      expect(String(reqUrl)).toMatch(/\/v1\/screening-requests$/);
      expect(JSON.parse(reqOpts.body).applicant_id).toBe("appl_123");
    });

    it("missing email → fail-loud throw, no applicant created", async () => {
      await expect(
        svc.createReport({ ...input, email: undefined })
      ).rejects.toThrow(/requires an email/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("applicant create returns no id → throws (no phantom order)", async () => {
      fetchMock.mockResolvedValueOnce(ok({}));
      await expect(svc.createReport(input)).rejects.toThrow(/applicant create returned no id/i);
      expect(fetchMock).toHaveBeenCalledTimes(1); // never reached the screening request
    });

    it("screening-request returns no id → throws (no phantom order)", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ id: "appl_123" }))
        .mockResolvedValueOnce(ok({ exam_url: "https://exam" }));
      await expect(svc.createReport(input)).rejects.toThrow(/screening request returned no id/i);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("non-2xx from ShareAble → fail-loud throw with categorical detail", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: "bad bundle" }),
      });
      await expect(svc.createReport(input)).rejects.toThrow(/ShareAble.*failed.*bad bundle/i);
    });
  });
});
