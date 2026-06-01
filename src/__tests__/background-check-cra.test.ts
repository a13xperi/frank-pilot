/**
 * Consumer-report CRA adapter — Checkr background lifecycle unit tests.
 *
 * Covers:
 *   - mapCheckrReportToResponse(): pure, table-driven; categorical-only output;
 *     sex-offender + felony/misdemeanor classification; criminalRecords exposed
 *     for the HUD engine.
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

import { BackgroundCheckService } from "../modules/screening/background-check";

describe("BackgroundCheckService — Checkr CRA mapping", () => {
  let svc: BackgroundCheckService;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = new BackgroundCheckService();
    delete process.env.CRIMINAL_DECISION_ENGINE_ENABLED;
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
});
