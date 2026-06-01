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

/**
 * In-house, credential-free, fully deterministic screening vendor.
 *
 * This is the DEFAULT vendor (registry resolves to "sandbox" when nothing is
 * configured) and the only vendor that can produce verdicts today with zero
 * credentials. It is what lets SCREENING_ON_SUBMIT_ENABLED be flipped on in a
 * dev/demo environment and produce real (clean) verdicts instead of parking
 * every applicant in could_not_screen.
 *
 * COMPLIANCE — why this is safe as the production default:
 *   The sandbox returns PASSING data. On its own that would be a catastrophic
 *   silent-pass in a keyless prod deploy. It is safe ONLY because every method
 *   self-gates on shouldUseScreeningStub(): when the gate is closed (real
 *   production, no MOCK_MODE / ALLOW_STUB_SCREENING / NODE_ENV=test) the method
 *   THROWS STUB_GATE_ERROR instead of returning clean data. The calling service
 *   then turns that throw into its fail-loud HOLD (could_not_screen for
 *   background/credit, review_required for income/nsopw, a propagating throw for
 *   employment). Net effect in real prod: byte-identical to today's keyless HOLD.
 *
 * The fixtures below are lifted verbatim from each service's former private
 * mockResponse()/stub literals, so MOCK_MODE demo tags and the no-key stub paths
 * behave exactly as before. Tag handling mirrors the old order precisely:
 *   MOCK_MODE=1 + screeningTag  → tagged fixture (unknown tag → clean default)
 *   else                         → gate, then clean stub
 */
export class SandboxVendor implements ScreeningVendor {
  readonly name = "sandbox";

  supports(_domain: ScreeningCheckDomain): boolean {
    return true;
  }

  /** Fail-loud gate: refuse to fabricate a verdict unless stub use is allowed. */
  private requireGate(): void {
    if (!shouldUseScreeningStub()) {
      throw new Error(STUB_GATE_ERROR);
    }
  }

  // ── background ──────────────────────────────────────────────────────────────

  async background(input: BackgroundVendorInput): Promise<BackgroundVendorResponse> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.backgroundFixture(input.screeningTag);
    }
    this.requireGate();
    logger.warn("Using sandbox background check — deterministic clean stub (stub policy allows fallback)");
    return this.backgroundClean();
  }

  private backgroundClean(): BackgroundVendorResponse {
    return { felonies: 0, sexOffenses: false, violentCrimes: false, misdemeanors: [], records: [] };
  }

  private backgroundFixture(tag: string): BackgroundVendorResponse {
    if (tag === "deny_felony") {
      return {
        felonies: 1,
        sexOffenses: false,
        violentCrimes: false,
        misdemeanors: [],
        records: [{ type: "felony", description: "synthetic" }],
      };
    }
    if (tag === "deny_sex_offender") {
      return {
        felonies: 0,
        sexOffenses: true,
        violentCrimes: false,
        misdemeanors: [],
        records: [{ type: "lifetime_registry", description: "synthetic" }],
      };
    }
    if (tag === "review_misdemeanors") {
      return {
        felonies: 0,
        sexOffenses: false,
        violentCrimes: false,
        misdemeanors: [{ code: "M-1" }, { code: "M-2" }, { code: "M-3" }],
        records: [],
      };
    }
    return this.backgroundClean();
  }

  // ── credit ──────────────────────────────────────────────────────────────────

  async credit(input: CreditVendorInput): Promise<CreditVendorResponse> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.creditFixture(input.screeningTag);
    }
    this.requireGate();
    logger.warn("Using sandbox credit check — deterministic clean stub (stub policy allows fallback)");
    return this.creditClean();
  }

  private creditClean(): CreditVendorResponse {
    return {
      creditScore: 680,
      paymentHistory: "good",
      outstandingDebts: 2500,
      collections: 0,
      evictions: 0,
      bankruptcies: 0,
    };
  }

  private creditFixture(tag: string): CreditVendorResponse {
    if (tag === "review_low_credit") {
      return {
        creditScore: 520,
        paymentHistory: "fair",
        outstandingDebts: 8200,
        collections: 1,
        evictions: 0,
        bankruptcies: 0,
      };
    }
    if (tag === "approve_clean") {
      return {
        creditScore: 720,
        paymentHistory: "excellent",
        outstandingDebts: 1200,
        collections: 0,
        evictions: 0,
        bankruptcies: 0,
      };
    }
    return this.creditClean();
  }

  // ── income ────────────────────────────────────────────────────────────────────

  async income(input: IncomeVendorInput): Promise<IncomeVendorResponse> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.incomeFixture(input.screeningTag);
    }
    this.requireGate();
    logger.warn("Using sandbox Plaid Income — deterministic clean stub (stub policy allows fallback)");
    return this.incomeClean();
  }

  private incomeClean(): IncomeVendorResponse {
    return {
      verified: true,
      annualIncomeCents: 5400000,
      monthlyAverageCents: 450000,
      sources: [{ type: "payroll", employer: "Acme Co", monthlyAverageCents: 450000 }],
      accountsLinked: 1,
      monthsHistory: 24,
    };
  }

  private incomeFixture(tag: string): IncomeVendorResponse {
    if (tag === "fraud_income_mismatch") {
      return {
        verified: true,
        annualIncomeCents: 3000000,
        monthlyAverageCents: 250000,
        sources: [{ type: "payroll", employer: "Acme Co", monthlyAverageCents: 250000 }],
        accountsLinked: 1,
        monthsHistory: 18,
      };
    }
    if (tag === "deny_income_over_ami") {
      return {
        verified: true,
        annualIncomeCents: 9000000,
        monthlyAverageCents: 750000,
        sources: [{ type: "payroll", employer: "Acme Co", monthlyAverageCents: 750000 }],
        accountsLinked: 1,
        monthsHistory: 24,
      };
    }
    return this.incomeClean();
  }

  // ── NSOPW ─────────────────────────────────────────────────────────────────────

  async nsopw(input: NsopwVendorInput): Promise<NsopwVendorResponse> {
    if (process.env.MOCK_MODE === "1" && input.screeningTag) {
      return this.nsopwFixture(input.screeningTag);
    }
    this.requireGate();
    logger.warn("Using sandbox direct NSOPW check — deterministic no-match stub (stub policy allows fallback)");
    return { records: [], searchedStates: input.states, confidence: 0.99, riskSignals: [] };
  }

  private nsopwFixture(tag: string): NsopwVendorResponse {
    if (tag === "deny_sex_offender") {
      return {
        records: [
          {
            state: "NV",
            nameMatch: true,
            dobMatch: true,
            addressHint: "Reno, NV (last known)",
            riskTier: "high",
          },
        ],
        searchedStates: ["NV"],
        confidence: 0.98,
        riskSignals: ["registry_match_name_and_dob"],
      };
    }
    return { records: [], searchedStates: ["NV"], confidence: 0.99, riskSignals: [] };
  }

  // ── employment ──────────────────────────────────────────────────────────────

  async employment(_input: EmploymentVendorInput): Promise<EmploymentVendorResponse> {
    // No demo tags for employment — work-number.ts never passed a screeningTag.
    this.requireGate();
    logger.warn("Using sandbox Work Number verification — deterministic stub (stub policy allows fallback)");
    return {
      result: "verified",
      details: {
        currentEmployer: "STUB Employer Inc.",
        employmentStatus: "active",
        hireDate: "2023-01-01",
        terminationDate: null,
        annualizedIncome: 45000,
        incomeSource: "employer_reported",
        rawResponse: { stub: true },
      },
    };
  }
}
