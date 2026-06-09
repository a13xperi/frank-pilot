/**
 * Consumer-report CRA adapter — Checkr background lifecycle unit tests.
 *
 * Covers:
 *   - mapCheckrReportToResponse(): pure, table-driven; categorical-only output;
 *     sex-offender + felony/misdemeanor classification; criminalRecords exposed
 *     for the HUD engine.
 *   - resolve(): reads the webhook-persisted verdict; could_not_screen HOLD when
 *     no report / pending / wrong shape / lookup throws; re-runs evaluateResults.
 *   - createReport(): keyless → fail-loud throw (no fabricated handle); keyed →
 *     real Checkr candidate + invitation flow over a mocked fetch.
 *
 * No network / no real DB: ../config/database query is mocked; the keyed
 * createReport tests mock global fetch.
 */

const mockQuery = jest.fn();

jest.mock("../config/database", () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { BackgroundCheckService } from "../modules/screening/background-check";

describe("BackgroundCheckService — Checkr CRA mapping", () => {
  let svc: BackgroundCheckService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new BackgroundCheckService();
    delete process.env.CRIMINAL_DECISION_ENGINE_ENABLED;
    // Keep the keyless createReport contract test deterministic even if a sibling
    // test file in the same worker left CHECKR_API_KEY set. The keyed describe
    // re-sets it in its own beforeEach (runs after this one).
    delete process.env.CHECKR_API_KEY;
  });

  describe("mapCheckrReportToResponse", () => {
    it("clean report → zero felonies, no sex offense, no records", () => {
      const r = svc.mapCheckrReportToResponse({
        sex_offender_search: { records: [] },
        national_criminal_search: { records: [] },
        county_criminal_searches: [],
      });
      expect(r.felonies).toBe(0);
      expect(r.sexOffenses).toBe(false);
      expect(r.violentCrimes).toBe(false);
      expect(r.misdemeanors).toEqual([]);
      expect(r.criminalRecords).toEqual([]);
    });

    it("sex-offender registry hit → sexOffenses + lifetime-registrant record", () => {
      const r = svc.mapCheckrReportToResponse({
        sex_offender_search: { records: [{ registry: "NV" }] },
      });
      expect(r.sexOffenses).toBe(true);
      expect(r.criminalRecords).toHaveLength(1);
      expect(r.criminalRecords[0].category).toBe("sex_offense_lifetime_registrant");
      expect(r.criminalRecords[0].lifetimeRegistrant).toBe(true);
    });

    it("a felony charge → felony count + felony_nonviolent record", () => {
      const r = svc.mapCheckrReportToResponse({
        national_criminal_search: {
          records: [{ classification: "Felony", disposition: "convicted", charge: "theft" }],
        },
      });
      expect(r.felonies).toBe(1);
      expect(r.criminalRecords[0].category).toBe("felony_nonviolent");
      expect(r.criminalRecords[0].disposition).toBe("convicted");
    });

    it("a violent felony → felony_violent + violentCrimes flag", () => {
      const r = svc.mapCheckrReportToResponse({
        national_criminal_search: {
          charges: [{ classification: "felony", charge: "aggravated assault" }],
        },
      });
      expect(r.felonies).toBe(1);
      expect(r.violentCrimes).toBe(true);
      expect(r.criminalRecords[0].category).toBe("felony_violent");
    });

    it("a misdemeanor → misdemeanors[] + misdemeanor record, no felony", () => {
      const r = svc.mapCheckrReportToResponse({
        county_criminal_searches: [
          { records: [{ classification: "misdemeanor", charge: "trespass" }] },
        ],
      });
      expect(r.felonies).toBe(0);
      expect(r.misdemeanors).toHaveLength(1);
      expect(r.criminalRecords[0].category).toBe("misdemeanor_nonviolent");
    });

    it("never throws on a malformed / empty report (defensive coercion)", () => {
      expect(() => svc.mapCheckrReportToResponse(undefined)).not.toThrow();
      expect(() => svc.mapCheckrReportToResponse({})).not.toThrow();
      expect(svc.mapCheckrReportToResponse(null).criminalRecords).toEqual([]);
    });

    it("output carries no charge narratives — only categorical fields", () => {
      const r = svc.mapCheckrReportToResponse({
        national_criminal_search: {
          records: [
            {
              classification: "Felony",
              charge: "Possession of a controlled substance, 14g, 123 Main St",
              ssn: "123-45-6789",
            },
          ],
        },
      });
      const rec: any = r.criminalRecords[0];
      // The structured record must not echo the free-text charge narrative or SSN.
      expect(rec.charge).toBeUndefined();
      expect(rec.ssn).toBeUndefined();
      expect(rec.description).toBeUndefined();
      expect(Object.keys(rec)).toEqual(
        expect.arrayContaining(["category"])
      );
    });
  });

  describe("resolve", () => {
    it("no report on file → could_not_screen HOLD", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ background_report_id: null }] });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
      expect(r.details.riskScore).toBe(-1);
    });

    it("report still pending (no completed_at) → could_not_screen HOLD", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ background_report_id: "rep_1", background_check_completed_at: null }],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
    });

    it("persisted clean verdict → pass (re-runs evaluateResults)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            background_report_id: "rep_1",
            background_check_completed_at: new Date(),
            background_check_details: {
              reportId: "rep_1",
              rawResponse: { felonies: 0, sexOffenses: false, violentCrimes: false, misdemeanors: [], records: [] },
            },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("pass");
    });

    it("persisted felony verdict → fail (legacy blanket-ban path)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            background_report_id: "rep_1",
            background_check_completed_at: new Date(),
            background_check_details: {
              rawResponse: { felonies: 1, sexOffenses: false, violentCrimes: false, misdemeanors: [], records: [] },
            },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("fail");
    });

    it("malformed persisted detail (no rawResponse) → could_not_screen HOLD", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            background_report_id: "rep_1",
            background_check_completed_at: new Date(),
            background_check_details: { reportId: "rep_1" },
          },
        ],
      });
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
    });

    it("DB lookup throws → could_not_screen HOLD (never a pass)", async () => {
      mockQuery.mockRejectedValueOnce(new Error("connection reset"));
      const r = await svc.resolve("app-1");
      expect(r.result).toBe("could_not_screen");
    });
  });

  describe("createReport", () => {
    it("throws (fail-loud) until Checkr credentialing exists", async () => {
      await expect(
        svc.createReport({
          applicationId: "app-1",
          firstName: "Sam",
          lastName: "Lee",
          ssnLast4: "6789",
          dateOfBirth: "1990-01-01",
          state: "NV",
        })
      ).rejects.toThrow(/not yet configured/i);
    });
  });

  describe("isConfigured — readiness preflight predicate", () => {
    afterEach(() => {
      delete process.env.CHECKR_API_KEY;
    });
    it("false with no key (keyless ⇒ submit() refuses to fire a Checkr order)", () => {
      delete process.env.CHECKR_API_KEY;
      expect(svc.isConfigured()).toBe(false);
    });
    it('false when the key is the "changeme" placeholder', () => {
      process.env.CHECKR_API_KEY = "changeme";
      expect(svc.isConfigured()).toBe(false);
    });
    it("true with a real key — lockstep with createReport()'s gate", () => {
      process.env.CHECKR_API_KEY = "ck_test_abc";
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe("createReport — keyed (real Checkr two-step over mocked fetch)", () => {
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      // Outer beforeEach deletes CHECKR_API_KEY and runs FIRST; arm it here.
      process.env.CHECKR_API_KEY = "ck_test_abc";
      delete process.env.CHECKR_API_URL;
      delete process.env.CHECKR_PACKAGE;
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });
    afterEach(() => {
      (global as any).fetch = realFetch;
      delete process.env.CHECKR_API_KEY;
    });

    const ok = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body });

    const input = {
      applicationId: "app-1",
      firstName: "Sam",
      lastName: "Lee",
      ssnLast4: "6789",
      dateOfBirth: "1990-01-01",
      state: "NV",
      email: "sam@example.com",
    };

    it("candidate → invitation; returns candidate.id as the webhook join key", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ id: "cand_123" }))
        .mockResolvedValueOnce(
          ok({ invitation_url: "https://apply.checkr.com/x", status: "pending" })
        );

      const handle = await svc.createReport(input);

      // candidate.id is the durable join key (the report id does not exist yet).
      expect(handle.reportId).toBe("cand_123");
      expect(handle.url).toBe("https://apply.checkr.com/x");
      expect(handle.status).toBe("pending");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [candUrl, candOpts] = fetchMock.mock.calls[0];
      expect(String(candUrl)).toMatch(/\/v1\/candidates$/);
      // HTTP Basic: base64(apiKey + ":") — empty password.
      expect((candOpts.headers as any).Authorization).toBe(
        "Basic " + Buffer.from("ck_test_abc:").toString("base64")
      );
      const candBody = JSON.parse(candOpts.body);
      expect(candBody.email).toBe("sam@example.com");
      expect(candBody.first_name).toBe("Sam");
      expect(candBody.dob).toBe("1990-01-01");
      // Full SSN / last-4 are NEVER sent — the hosted invitation collects it.
      expect(candBody.ssn).toBeUndefined();
      expect(candBody.ssn_last4).toBeUndefined();
      expect(JSON.stringify(candBody)).not.toContain("6789");

      const [invUrl, invOpts] = fetchMock.mock.calls[1];
      expect(String(invUrl)).toMatch(/\/v1\/invitations$/);
      expect(JSON.parse(invOpts.body).candidate_id).toBe("cand_123");
    });

    it("missing email → fail-loud throw, no candidate created", async () => {
      await expect(
        svc.createReport({ ...input, email: undefined })
      ).rejects.toThrow(/requires an applicant email/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("candidate create returns no id → throws (no phantom order)", async () => {
      fetchMock.mockResolvedValueOnce(ok({}));
      await expect(svc.createReport(input)).rejects.toThrow(/returned no id/i);
      expect(fetchMock).toHaveBeenCalledTimes(1); // never reached the invitation
    });

    it("non-2xx from Checkr → fail-loud throw with categorical detail", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: "bad package" }),
      });
      await expect(svc.createReport(input)).rejects.toThrow(/Checkr.*failed.*bad package/i);
    });
  });
});
