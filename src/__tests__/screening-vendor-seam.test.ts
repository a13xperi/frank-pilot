/**
 * Contract for the screening vendor seam (src/modules/screening/vendors).
 *
 * Three things under test:
 *   1. registry.resolveVendor() — precedence, default, unsupported-domain refusal.
 *   2. SandboxVendor — self-gating fail-loud (the property that makes "sandbox"
 *      a safe production DEFAULT), plus the MOCK_MODE demo fixtures.
 *   3. PlaidVendor — dormant without creds; with creds it performs the real
 *      sandbox handshake (mocked fetch) and maps deposits to income, and it
 *      THROWS (never fabricates a pass) on HTTP error / empty signal.
 *
 * The existing screening-integrations / screening-dormant-adapters /
 * screening-extended-checks suites already prove the SERVICES wired through this
 * seam behave byte-identically. This suite proves the seam itself.
 */

import { resolveVendor, resolveVendorName } from "../modules/screening/vendors/registry";
import { SandboxVendor } from "../modules/screening/vendors/sandbox-vendor";
import { PlaidVendor } from "../modules/screening/vendors/plaid-vendor";
import { WorkNumberVendor } from "../modules/screening/vendors/work-number-vendor";
import { STUB_GATE_ERROR } from "../modules/screening/stub-policy";

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ENV_KEYS = [
  "NODE_ENV",
  "MOCK_MODE",
  "ALLOW_STUB_SCREENING",
  "SCREENING_VENDOR",
  "SCREENING_VENDOR_BACKGROUND",
  "SCREENING_VENDOR_CREDIT",
  "SCREENING_VENDOR_INCOME",
  "SCREENING_VENDOR_NSOPW",
  "SCREENING_VENDOR_EMPLOYMENT",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "WORK_NUMBER_API_KEY",
  "WORK_NUMBER_API_URL",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) if (k !== "NODE_ENV") delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
});

function disableStub() {
  process.env.NODE_ENV = "production";
  delete process.env.MOCK_MODE;
  delete process.env.ALLOW_STUB_SCREENING;
}

function person() {
  return { firstName: "Jane", lastName: "Doe", dateOfBirth: "1990-06-15" };
}

// ── Registry ─────────────────────────────────────────────────────────────────

describe("registry.resolveVendor()", () => {
  const DOMAINS = ["background", "credit", "income", "nsopw", "employment"] as const;

  it("defaults every domain to the sandbox vendor", () => {
    for (const d of DOMAINS) {
      expect(resolveVendorName(d)).toBe("sandbox");
      expect(resolveVendor(d).name).toBe("sandbox");
    }
  });

  it("SCREENING_VENDOR_<DOMAIN> overrides the global SCREENING_VENDOR", () => {
    process.env.SCREENING_VENDOR = "sandbox";
    process.env.SCREENING_VENDOR_INCOME = "plaid";
    expect(resolveVendorName("income")).toBe("plaid");
    expect(resolveVendor("income").name).toBe("plaid");
    // Other domains keep the global.
    expect(resolveVendor("background").name).toBe("sandbox");
  });

  it("refuses (throws) when the configured vendor does not support the domain", () => {
    process.env.SCREENING_VENDOR = "plaid"; // plaid only supports income
    expect(() => resolveVendor("background")).toThrow(/does not support the background check/i);
    expect(() => resolveVendor("nsopw")).toThrow(/does not support the nsopw check/i);
    // income is supported
    expect(resolveVendor("income").name).toBe("plaid");
  });

  it("throws on an unknown vendor name", () => {
    process.env.SCREENING_VENDOR_CREDIT = "experian-typo";
    expect(() => resolveVendor("credit")).toThrow(/Unknown screening vendor "experian-typo"/i);
  });

  it("is case-insensitive and trims whitespace", () => {
    process.env.SCREENING_VENDOR_INCOME = "  PLAID  ";
    expect(resolveVendorName("income")).toBe("plaid");
  });

  it("resolves worknumber for employment but refuses it elsewhere", () => {
    process.env.SCREENING_VENDOR_EMPLOYMENT = "worknumber";
    expect(resolveVendor("employment").name).toBe("worknumber");
    // Globally selecting worknumber must NOT silently pass non-employment checks.
    process.env.SCREENING_VENDOR = "worknumber";
    delete process.env.SCREENING_VENDOR_EMPLOYMENT;
    expect(() => resolveVendor("background")).toThrow(/does not support the background check/i);
    expect(() => resolveVendor("income")).toThrow(/does not support the income check/i);
    expect(resolveVendor("employment").name).toBe("worknumber");
  });
});

// ── SandboxVendor: self-gating fail-loud ───────────────────────────────────────

describe("SandboxVendor — self-gating (the reason 'sandbox' is a safe default)", () => {
  it("with the gate OPEN (NODE_ENV=test) returns clean/passing data for every domain", async () => {
    const v = new SandboxVendor();
    expect((await v.background({ ...person(), ssnLast4: "6789", state: "NV" })).felonies).toBe(0);
    expect((await v.credit({ ...person(), ssnLast4: "6789" })).creditScore).toBe(680);
    const inc = await v.income(person());
    expect(inc.verified).toBe(true);
    expect(inc.annualIncomeCents).toBe(5400000);
    expect((await v.nsopw({ ...person(), states: ["NV"] })).records).toHaveLength(0);
    const emp = await v.employment({ ...person(), ssn: "123-45-6789" });
    expect(emp.result).toBe("verified");
    expect(emp.details.currentEmployer).toBe("STUB Employer Inc.");
  });

  it("with the gate CLOSED (keyless production) THROWS STUB_GATE_ERROR for every domain", async () => {
    disableStub();
    const v = new SandboxVendor();
    await expect(v.background({ ...person(), ssnLast4: "6789", state: "NV" })).rejects.toThrow(STUB_GATE_ERROR);
    await expect(v.credit({ ...person(), ssnLast4: "6789" })).rejects.toThrow(STUB_GATE_ERROR);
    await expect(v.income(person())).rejects.toThrow(STUB_GATE_ERROR);
    await expect(v.nsopw({ ...person(), states: ["NV"] })).rejects.toThrow(STUB_GATE_ERROR);
    await expect(v.employment({ ...person(), ssn: "123-45-6789" })).rejects.toThrow(STUB_GATE_ERROR);
  });

  it("ALLOW_STUB_SCREENING=1 reopens the gate in production", async () => {
    disableStub();
    process.env.ALLOW_STUB_SCREENING = "1";
    const v = new SandboxVendor();
    expect((await v.income(person())).verified).toBe(true);
  });

  it("MOCK_MODE demo fixtures pass the gate and return the tagged synthetic data", async () => {
    process.env.NODE_ENV = "production"; // gate otherwise closed
    process.env.MOCK_MODE = "1";
    const v = new SandboxVendor();

    expect((await v.background({ ...person(), ssnLast4: "6789", state: "NV", screeningTag: "deny_felony" })).felonies).toBe(1);
    expect((await v.background({ ...person(), ssnLast4: "6789", state: "NV", screeningTag: "deny_sex_offender" })).sexOffenses).toBe(true);
    expect((await v.credit({ ...person(), ssnLast4: "6789", screeningTag: "review_low_credit" })).creditScore).toBe(520);
    expect((await v.income({ ...person(), screeningTag: "fraud_income_mismatch" })).annualIncomeCents).toBe(3000000);

    const nsopwMatch = await v.nsopw({ ...person(), states: ["NV"], screeningTag: "deny_sex_offender" });
    expect(nsopwMatch.records).toHaveLength(1);
    expect(nsopwMatch.records[0].riskTier).toBe("high");

    // Employment demo tags (the Work Number end-to-end loop fixtures).
    const empDispute = await v.employment({ ...person(), ssn: "123-45-6789", screeningTag: "wn_employer_dispute" });
    expect(empDispute.result).toBe("review_required");
    const empMismatch = await v.employment({ ...person(), ssn: "123-45-6789", screeningTag: "wn_income_mismatch" });
    expect(empMismatch.result).toBe("verified");
    expect(empMismatch.details.annualizedIncome).toBe(30000); // trips the >15% Plaid cross-check

    // Unknown tag → clean default (mirrors the old mockResponse fallthrough).
    expect((await v.income({ ...person(), screeningTag: "no_such_tag" })).annualIncomeCents).toBe(5400000);
    expect((await v.employment({ ...person(), ssn: "1", screeningTag: "no_such_tag" })).result).toBe("verified");
  });

  it("the wn_vendor_outage employment tag THROWS (drives the fail-loud could_not_screen HOLD)", async () => {
    process.env.NODE_ENV = "production";
    process.env.MOCK_MODE = "1";
    const v = new SandboxVendor();
    await expect(
      v.employment({ ...person(), ssn: "123-45-6789", screeningTag: "wn_vendor_outage" })
    ).rejects.toThrow(/vendor outage/i);
  });

  it("supports() is true for every domain", () => {
    const v = new SandboxVendor();
    for (const d of ["background", "credit", "income", "nsopw", "employment"] as const) {
      expect(v.supports(d)).toBe(true);
    }
  });
});

// ── PlaidVendor: dormant scaffold ──────────────────────────────────────────────

describe("PlaidVendor — dormant without creds, live (mocked) with creds", () => {
  it("supports only the income domain", () => {
    const v = new PlaidVendor();
    expect(v.supports("income")).toBe(true);
    expect(v.supports("background")).toBe(false);
    expect(v.supports("nsopw")).toBe(false);
  });

  it("non-income methods throw defensively", async () => {
    const v = new PlaidVendor();
    await expect(v.background({ ...person(), ssnLast4: "6789", state: "NV" })).rejects.toThrow(/supports only the income check/i);
  });

  it("no creds + gate closed → THROWS STUB_GATE_ERROR (stays dormant, fail-loud)", async () => {
    disableStub();
    await expect(new PlaidVendor().income(person())).rejects.toThrow(STUB_GATE_ERROR);
  });

  it("no creds + gate open → returns the deterministic stub (verified)", async () => {
    // jest NODE_ENV=test keeps the gate open
    const r = await new PlaidVendor().income(person());
    expect(r.verified).toBe(true);
    expect(r.annualIncomeCents).toBe(5400000);
  });

  describe("with creds (mocked fetch)", () => {
    let fetchMock: jest.Mock;
    const origFetch = global.fetch;

    beforeEach(() => {
      process.env.PLAID_CLIENT_ID = "test-client";
      process.env.PLAID_SECRET = "test-secret";
      process.env.PLAID_ENV = "sandbox";
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });

    afterEach(() => {
      (global as any).fetch = origFetch;
    });

    function ok(json: unknown) {
      return { ok: true, status: 200, json: async () => json };
    }

    it("runs create → exchange → transactions and maps deposits to income", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ public_token: "public-sandbox-123" }))
        .mockResolvedValueOnce(ok({ access_token: "access-sandbox-123" }))
        .mockResolvedValueOnce(
          ok({
            accounts: [{ account_id: "acc-1" }],
            transactions: [
              { amount: -2000, name: "Payroll" }, // deposit
              { amount: -2000, name: "Payroll" }, // deposit
              { amount: 35.5, name: "Coffee" }, // debit, ignored
            ],
          })
        );

      const r = await new PlaidVendor().income(person());

      // 4000 in deposits over a 3-month window → 400000 cents total / 3.
      expect(r.monthlyAverageCents).toBe(133333);
      expect(r.annualIncomeCents).toBe(133333 * 12);
      expect(r.verified).toBe(true);
      expect(r.accountsLinked).toBe(1);
      expect(r.sources).toHaveLength(1);

      // Hit the sandbox host with creds in the body.
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://sandbox.plaid.com/sandbox/public_token/create");
      const body = JSON.parse((opts as any).body);
      expect(body.client_id).toBe("test-client");
      expect(body.secret).toBe("test-secret");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("THROWS on a Plaid HTTP error (→ service HOLDs, never a false pass)", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error_code: "INVALID_API_KEYS", error_message: "bad creds" }),
      });
      await expect(new PlaidVendor().income(person())).rejects.toThrow(/INVALID_API_KEYS/);
    });

    it("THROWS when no deposits are found rather than reporting $0 verified", async () => {
      fetchMock
        .mockResolvedValueOnce(ok({ public_token: "public-sandbox-123" }))
        .mockResolvedValueOnce(ok({ access_token: "access-sandbox-123" }))
        .mockResolvedValueOnce(ok({ accounts: [{ account_id: "acc-1" }], transactions: [{ amount: 50 }] }));

      await expect(new PlaidVendor().income(person())).rejects.toThrow(/no deposit transactions/i);
    });

    it("skips the bootstrap when a caller-supplied access_token is present", async () => {
      fetchMock.mockResolvedValueOnce(
        ok({ accounts: [{ account_id: "acc-1" }], transactions: [{ amount: -3000 }] })
      );

      const r = await new PlaidVendor().income({ ...person(), plaidAccessToken: "access-preexisting" });
      expect(r.verified).toBe(true);
      // Only the transactions call — no create/exchange.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("https://sandbox.plaid.com/transactions/get");
    });
  });
});

// ── WorkNumberVendor: dormant Equifax/TWN employment scaffold ──────────────────

describe("WorkNumberVendor — dormant without a key, live (mocked) with a key", () => {
  const emp = () => ({ firstName: "Jane", lastName: "Doe", ssn: "123-45-6789", dateOfBirth: "1990-06-15" });

  it("supports only the employment domain", () => {
    const v = new WorkNumberVendor();
    expect(v.supports("employment")).toBe(true);
    expect(v.supports("income")).toBe(false);
    expect(v.supports("background")).toBe(false);
    expect(v.supports("credit")).toBe(false);
    expect(v.supports("nsopw")).toBe(false);
  });

  it("non-employment methods throw defensively", async () => {
    const v = new WorkNumberVendor();
    await expect(v.background({ ...person(), ssnLast4: "6789", state: "NV" })).rejects.toThrow(/supports only the employment check/i);
    await expect(v.income(person())).rejects.toThrow(/supports only the employment check/i);
  });

  it("no key + gate closed → THROWS STUB_GATE_ERROR (stays dormant, fail-loud — propagates to could_not_screen)", async () => {
    disableStub();
    await expect(new WorkNumberVendor().employment(emp())).rejects.toThrow(STUB_GATE_ERROR);
  });

  it("no key + gate open → returns the deterministic stub (verified)", async () => {
    // jest NODE_ENV=test keeps the gate open
    const r = await new WorkNumberVendor().employment(emp());
    expect(r.result).toBe("verified");
    expect(r.details.currentEmployer).toBe("STUB Employer Inc.");
  });

  describe("with a key (mocked fetch)", () => {
    let fetchMock: jest.Mock;
    const origFetch = global.fetch;

    beforeEach(() => {
      disableStub(); // prove the live path runs even with the stub gate closed
      process.env.WORK_NUMBER_API_KEY = "twn-test-key";
      process.env.WORK_NUMBER_API_URL = "https://api.twn.test";
      fetchMock = jest.fn();
      (global as any).fetch = fetchMock;
    });

    afterEach(() => {
      (global as any).fetch = origFetch;
    });

    function ok(json: unknown) {
      return { ok: true, status: 200, json: async () => json };
    }

    it("POSTs to /v1/verifications with a Bearer token and the applicant body", async () => {
      fetchMock.mockResolvedValueOnce(
        ok({ employments: [{ status: "active", employerName: "Acme Co", annualizedIncome: 72000 }] })
      );
      const r = await new WorkNumberVendor().employment(emp());
      expect(r.result).toBe("verified");
      expect(r.details.currentEmployer).toBe("Acme Co");
      expect(r.details.annualizedIncome).toBe(72000);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.twn.test/v1/verifications");
      expect((opts as any).method).toBe("POST");
      expect((opts as any).headers.Authorization).toBe("Bearer twn-test-key");
      const body = JSON.parse((opts as any).body);
      expect(body.ssn).toBe("123-45-6789");
      expect(body.firstName).toBe("Jane");
    });

    it("maps an empty employment list to no_record (a real verdict, not a failure)", async () => {
      fetchMock.mockResolvedValueOnce(ok({ employments: [] }));
      const r = await new WorkNumberVendor().employment(emp());
      expect(r.result).toBe("no_record");
    });

    it("maps a record with no income to partial", async () => {
      fetchMock.mockResolvedValueOnce(ok({ employments: [{ status: "active", employerName: "Acme Co" }] }));
      const r = await new WorkNumberVendor().employment(emp());
      expect(r.result).toBe("partial");
      expect(r.details.currentEmployer).toBe("Acme Co");
    });

    it("maps multiple active employers to review_required", async () => {
      fetchMock.mockResolvedValueOnce(
        ok({
          employments: [
            { status: "active", employerName: "Acme Co", annualizedIncome: 50000 },
            { status: "active", employerName: "Globex", annualizedIncome: 40000 },
          ],
        })
      );
      const r = await new WorkNumberVendor().employment(emp());
      expect(r.result).toBe("review_required");
    });

    it("THROWS on a TWN HTTP error (→ propagates to could_not_screen, never a false pass)", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ code: "SERVICE_UNAVAILABLE", message: "down" }),
      });
      await expect(new WorkNumberVendor().employment(emp())).rejects.toThrow(/SERVICE_UNAVAILABLE/);
    });

    it("THROWS on a network error rather than fabricating a verdict", async () => {
      fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
      await expect(new WorkNumberVendor().employment(emp())).rejects.toThrow(/ECONNRESET/);
    });
  });
});
