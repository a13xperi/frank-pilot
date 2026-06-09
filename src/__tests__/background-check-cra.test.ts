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
    const ORIGINAL_FETCH = global.fetch;
    afterEach(() => {
      global.fetch = ORIGINAL_FETCH;
      delete process.env.CHECKR_API_KEY;
      delete process.env.CHECKR_API_URL;
      delete process.env.CHECKR_PACKAGE;
    });

    const baseInput = {
      applicationId: "app-1",
      firstName: "Sam",
      lastName: "Lee",
      ssnLast4: "6789",
      dateOfBirth: "1990-01-01",
      state: "NV",
      email: "sam@example.com",
    };

    // Queue HTTP responses in call order; returns the captured calls for asserts.
    function mockFetchSequence(
      responses: Array<{ ok: boolean; status?: number; body: unknown }>
    ): Array<{ url: string; init: any }> {
      const calls: Array<{ url: string; init: any }> = [];
      let i = 0;
      global.fetch = jest.fn(async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        const r = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return {
          ok: r.ok,
          status: r.status ?? (r.ok ? 200 : 400),
          json: async () => r.body,
          text: async () =>
            typeof r.body === "string" ? r.body : JSON.stringify(r.body),
        } as any;
      }) as any;
      return calls;
    }

    it("keyless → fail-loud throw, never a fabricated handle", async () => {
      // No CHECKR_API_KEY set: must throw (no fake invitation url), and the
      // historical message keeps the contract stable.
      await expect(svc.createReport(baseInput)).rejects.toThrow(/not yet configured/i);
    });

    it("placeholder 'changeme' key is treated as keyless (throws)", async () => {
      process.env.CHECKR_API_KEY = "changeme";
      await expect(svc.createReport(baseInput)).rejects.toThrow(/not yet configured/i);
    });

    it("keyed but no applicant email → fail-loud, no network call", async () => {
      process.env.CHECKR_API_KEY = "test_key";
      const calls = mockFetchSequence([]);
      await expect(
        svc.createReport({ ...baseInput, email: undefined })
      ).rejects.toThrow(/requires an applicant email/i);
      expect(calls.length).toBe(0);
    });

    it("keyed happy path → candidate then invitation; returns candidate.id + hosted url", async () => {
      process.env.CHECKR_API_KEY = "test_key";
      const calls = mockFetchSequence([
        { ok: true, body: { id: "cand_123" } },
        {
          ok: true,
          body: { invitation_url: "https://apply.checkr.com/abc", status: "pending" },
        },
      ]);

      const handle = await svc.createReport(baseInput);

      // candidate.id (NOT a report id — none exists at create time) is the join key.
      expect(handle.reportId).toBe("cand_123");
      expect(handle.url).toBe("https://apply.checkr.com/abc");
      expect(handle.status).toBe("pending");

      // Candidate first, then invitation — in order.
      expect(calls.map((c) => c.url)).toEqual([
        "https://api.checkr.com/v1/candidates",
        "https://api.checkr.com/v1/invitations",
      ]);
      const invBody = JSON.parse(calls[1].init.body);
      expect(invBody.candidate_id).toBe("cand_123");
    });

    it("NEVER transmits a full SSN — only name/email/dob leave us", async () => {
      process.env.CHECKR_API_KEY = "test_key";
      const calls = mockFetchSequence([
        { ok: true, body: { id: "cand_123" } },
        { ok: true, body: { invitation_url: "https://x", status: "pending" } },
      ]);

      await svc.createReport(baseInput);

      const candBody = JSON.parse(calls[0].init.body);
      // The hosted invitation collects the full SSN from the applicant; we hold
      // only ssnLast4 and it must never be sent.
      expect(JSON.stringify(candBody)).not.toContain("6789");
      expect(candBody.ssn).toBeUndefined();
      expect(candBody.email).toBe("sam@example.com");
    });

    it("candidate create returns no id → fail-loud throw", async () => {
      process.env.CHECKR_API_KEY = "test_key";
      mockFetchSequence([{ ok: true, body: {} }]);
      await expect(svc.createReport(baseInput)).rejects.toThrow(/no id/i);
    });

    it("non-2xx from Checkr → fail-loud throw (caller HOLDs, never a fake handle)", async () => {
      process.env.CHECKR_API_KEY = "test_key";
      mockFetchSequence([{ ok: false, status: 422, body: { error: "bad package" } }]);
      await expect(svc.createReport(baseInput)).rejects.toThrow(/Checkr .*failed/i);
    });

    it("authenticates with HTTP Basic (API key as username, empty password)", async () => {
      process.env.CHECKR_API_KEY = "secret_key";
      const calls = mockFetchSequence([
        { ok: true, body: { id: "cand_1" } },
        { ok: true, body: { invitation_url: "https://x", status: "pending" } },
      ]);

      await svc.createReport(baseInput);

      const auth = calls[0].init.headers.Authorization as string;
      expect(auth.startsWith("Basic ")).toBe(true);
      expect(Buffer.from(auth.slice(6), "base64").toString()).toBe("secret_key:");
    });
  });
});
