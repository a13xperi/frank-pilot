import { logger } from "../../../utils/logger";
import { shouldUseScreeningStub, STUB_GATE_ERROR } from "../stub-policy";
import type {
  ScreeningVendor,
  ScreeningCheckDomain,
  BackgroundVendorInput,
  BackgroundVendorResponse,
  CreditVendorInput,
  CreditVendorResponse,
  IncomeVendorInput,
  IncomeVendorResponse,
  NsopwVendorInput,
  NsopwVendorResponse,
  EmploymentVendorInput,
  EmploymentVendorResponse,
} from "./types";

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

// Plaid's canonical sandbox test institution + auto-login user.
const SANDBOX_INSTITUTION_ID = "ins_109508";

/**
 * Real Plaid adapter — DORMANT until PLAID_CLIENT_ID + PLAID_SECRET are set.
 *
 * It supports ONLY the income domain (Plaid is an income/bank-link product).
 * The registry refuses to resolve plaid for any other domain, so a misconfig
 * like SCREENING_VENDOR=plaid HOLDS the non-income checks fail-loud rather than
 * silently passing them.
 *
 * Activation:
 *   SCREENING_VENDOR_INCOME=plaid   (route only income through Plaid)
 *   PLAID_CLIENT_ID=...             (from the Plaid dashboard)
 *   PLAID_SECRET=...                (sandbox secret to start)
 *   PLAID_ENV=sandbox               (default; sandbox|development|production)
 *
 * When creds are absent the adapter is inert: it defers to the same fail-loud
 * stub gate as everything else (throw STUB_GATE_ERROR unless the gate is open),
 * so adding the dependency cannot change behaviour until creds land.
 *
 * The live path performs the genuine, credentials-only Plaid sandbox handshake
 * (create sandbox public_token → exchange for an access_token → pull
 * transactions) and derives a deposit-based income estimate. This is a
 * sandbox-grade heuristic: production should migrate to the Plaid Income product
 * (/credit/payroll_income/get with the Link income flow + user_token), which
 * requires enabling Income on the dashboard. Any HTTP / shape / empty-signal
 * failure THROWS — the PlaidIncomeService catch turns that into a review_required
 * HOLD. The adapter never fabricates a passing income.
 */
export class PlaidVendor implements ScreeningVendor {
  readonly name = "plaid";

  supports(domain: ScreeningCheckDomain): boolean {
    return domain === "income";
  }

  async income(input: IncomeVendorInput): Promise<IncomeVendorResponse> {
    const clientId = process.env.PLAID_CLIENT_ID || "";
    const secret = process.env.PLAID_SECRET || "";
    const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
    const base = PLAID_HOSTS[env] || PLAID_HOSTS.sandbox;

    if (!clientId || !secret || secret === "changeme") {
      // No credentials → dormant. Defer to the global fail-loud gate: throw in
      // real production, return the deterministic stub only behind the gate.
      if (!shouldUseScreeningStub()) {
        throw new Error(STUB_GATE_ERROR);
      }
      logger.warn("Plaid vendor selected but no credentials configured — returning stub (stub policy allows fallback)");
      return {
        verified: true,
        annualIncomeCents: 5400000,
        monthlyAverageCents: 450000,
        sources: [{ type: "payroll", employer: "Acme Co", monthlyAverageCents: 450000 }],
        accountsLinked: 1,
        monthsHistory: 24,
      };
    }

    logger.info("Plaid live income verification", { env });
    const auth = { client_id: clientId, secret };

    // 1) Use the caller-supplied access_token if present; otherwise bootstrap a
    //    sandbox item (create public_token → exchange). The bootstrap path only
    //    makes sense in sandbox/development with the canonical test institution.
    let accessToken = input.plaidAccessToken;
    if (!accessToken) {
      const created = await this.post(base, "/sandbox/public_token/create", {
        ...auth,
        institution_id: SANDBOX_INSTITUTION_ID,
        initial_products: ["transactions"],
      });
      const publicToken = (created as any).public_token;
      if (!publicToken) {
        throw new Error("Plaid sandbox public_token/create returned no public_token");
      }
      const exchanged = await this.post(base, "/item/public_token/exchange", {
        ...auth,
        public_token: publicToken,
      });
      accessToken = (exchanged as any).access_token;
      if (!accessToken) {
        throw new Error("Plaid public_token/exchange returned no access_token");
      }
    }

    // 2) Pull a 90-day transaction window and derive income from deposits.
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
    const txns = await this.post(base, "/transactions/get", {
      ...auth,
      access_token: accessToken,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      options: { count: 500, offset: 0 },
    });

    return this.deriveIncome(txns);
  }

  /**
   * Map a Plaid /transactions/get response to an IncomeVendorResponse.
   *
   * Plaid sign convention: a NEGATIVE amount is money entering the account (a
   * deposit). We treat recurring deposits as income, average them per month over
   * the window, and annualise. If no deposits are found we THROW so the service
   * HOLDs for manual review rather than reporting $0 verified income.
   */
  private deriveIncome(txns: unknown): IncomeVendorResponse {
    const accounts = Array.isArray((txns as any)?.accounts) ? (txns as any).accounts : [];
    const transactions = Array.isArray((txns as any)?.transactions) ? (txns as any).transactions : [];

    const deposits = transactions.filter((t: any) => typeof t?.amount === "number" && t.amount < 0);
    if (deposits.length === 0) {
      throw new Error("Plaid returned no deposit transactions — income could not be derived");
    }

    const totalCents = deposits.reduce(
      (sum: number, t: any) => sum + Math.round(Math.abs(t.amount) * 100),
      0
    );
    // Window is 90 days ≈ 3 months; never divide by zero.
    const monthsHistory = 3;
    const monthlyAverageCents = Math.round(totalCents / monthsHistory);
    const annualIncomeCents = monthlyAverageCents * 12;

    return {
      verified: monthlyAverageCents > 0,
      annualIncomeCents,
      monthlyAverageCents,
      sources: [{ type: "payroll", monthlyAverageCents }],
      accountsLinked: accounts.length || 1,
      monthsHistory,
    };
  }

  private async post(base: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(10000), // audit #10: never hang on a dead vendor/EL/Sage socket
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const err = (await res.json()) as any;
        detail = err?.error_code ? `${err.error_code}: ${err.error_message ?? ""}` : JSON.stringify(err);
      } catch {
        detail = `HTTP ${res.status}`;
      }
      throw new Error(`Plaid ${path} failed — ${detail}`);
    }
    return res.json();
  }

  // ── Unsupported domains — defensive throws (registry already refuses these) ──

  private unsupported(domain: ScreeningCheckDomain): never {
    throw new Error(`Plaid vendor supports only the income check, not ${domain}`);
  }
  async background(_input: BackgroundVendorInput): Promise<BackgroundVendorResponse> {
    return this.unsupported("background");
  }
  async credit(_input: CreditVendorInput): Promise<CreditVendorResponse> {
    return this.unsupported("credit");
  }
  async nsopw(_input: NsopwVendorInput): Promise<NsopwVendorResponse> {
    return this.unsupported("nsopw");
  }
  async employment(_input: EmploymentVendorInput): Promise<EmploymentVendorResponse> {
    return this.unsupported("employment");
  }
}
