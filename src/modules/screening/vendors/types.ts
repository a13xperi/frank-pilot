/**
 * Screening vendor seam — the pluggable abstraction that lets Frank swap the
 * source of each screening signal (background, credit, income, NSOPW,
 * employment) without touching the compliance logic in the check services.
 *
 * Design contract (why this seam exists):
 * - Each check SERVICE owns Frank's compliance POLICY (evaluateResults +
 *   pass/fail/review/could_not_screen semantics + its catch/throw behaviour).
 * - Each VENDOR owns only "produce a raw response, or refuse." A vendor never
 *   decides pass/fail — it returns facts (or throws) and the service judges.
 *
 * The fail-loud invariant (stub-policy.ts) lives BELOW this seam: a vendor that
 * cannot legitimately produce a verdict (keyless production, no escape hatch)
 * MUST throw STUB_GATE_ERROR rather than fabricate a passing response. The
 * SandboxVendor self-gates on shouldUseScreeningStub() precisely so that the
 * default vendor resolution ("sandbox") stays safe in production — a keyless
 * prod deploy still HOLDS every applicant, byte-identical to today.
 *
 * The raw response shapes below are exactly what each service's evaluateResults
 * already consumes (previously the private mockResponse/stub literals). Typing
 * them here makes the seam contract explicit without changing any verdict math.
 */

export type ScreeningCheckDomain =
  | "background"
  | "credit"
  | "income"
  | "nsopw"
  | "employment";

// ── background ──────────────────────────────────────────────────────────────

export interface BackgroundVendorInput {
  firstName: string;
  lastName: string;
  ssnLast4: string;
  dateOfBirth: string;
  state: string;
  screeningTag?: string;
}

export interface BackgroundVendorResponse {
  felonies: number;
  sexOffenses: boolean;
  violentCrimes: boolean;
  misdemeanors: unknown[];
  records: unknown[];
}

// ── credit ──────────────────────────────────────────────────────────────────

export interface CreditVendorInput {
  firstName: string;
  lastName: string;
  ssnLast4: string;
  dateOfBirth: string;
  screeningTag?: string;
}

export interface CreditVendorResponse {
  creditScore: number;
  paymentHistory: string;
  outstandingDebts: number;
  collections: number;
  evictions: number;
  bankruptcies: number;
}

// ── income (Plaid-shaped) ─────────────────────────────────────────────────────

export interface IncomeVendorInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  plaidAccessToken?: string;
  screeningTag?: string;
}

export interface IncomeVendorResponse {
  verified: boolean;
  annualIncomeCents: number;
  monthlyAverageCents: number;
  sources: Array<{
    type: "payroll" | "self_employment" | "benefits" | "other";
    employer?: string;
    monthlyAverageCents: number;
  }>;
  accountsLinked: number;
  monthsHistory: number;
}

// ── NSOPW ─────────────────────────────────────────────────────────────────────

export interface NsopwVendorInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  states: string[];
  screeningTag?: string;
}

export interface NsopwVendorRecord {
  state: string;
  nameMatch: boolean;
  dobMatch: boolean;
  addressHint?: string;
  riskTier: "high" | "medium" | "low";
}

export interface NsopwVendorResponse {
  records: NsopwVendorRecord[];
  searchedStates: string[];
  confidence: number;
  riskSignals: string[];
}

// ── employment (Work Number-shaped) ───────────────────────────────────────────
//
// Employment is the one domain where the vendor returns a near-final verdict
// rather than raw facts: work-number.ts has no evaluateResults step (it has no
// internal try/catch either — the P1 fail-loud contract requires the gate throw
// to PROPAGATE). So the employment vendor response is structurally identical to
// WorkNumberResult and the service returns it directly.

export interface EmploymentVendorInput {
  firstName: string;
  lastName: string;
  ssn: string;
  dateOfBirth: string;
  screeningTag?: string;
}

export interface EmploymentVendorResponse {
  result: "verified" | "no_record" | "partial" | "review_required";
  details: {
    currentEmployer?: string;
    employmentStatus?: "active" | "inactive" | "unknown";
    hireDate?: string;
    terminationDate?: string | null;
    annualizedIncome?: number;
    incomeSource?: "employer_reported" | "calculated" | "self_reported";
    rawResponse?: Record<string, unknown>;
  };
}

// ── the vendor interface ──────────────────────────────────────────────────────

/**
 * A screening vendor supplies raw responses for one or more check domains.
 *
 * A vendor that does not support a domain MUST report so via supports() — the
 * registry refuses to resolve an unsupported (vendor, domain) pair and throws,
 * which the calling service turns into a fail-loud HOLD. The per-domain methods
 * of an unsupported domain may also throw defensively; they should never return
 * a fabricated passing response.
 */
export interface ScreeningVendor {
  readonly name: string;
  supports(domain: ScreeningCheckDomain): boolean;
  background(input: BackgroundVendorInput): Promise<BackgroundVendorResponse>;
  credit(input: CreditVendorInput): Promise<CreditVendorResponse>;
  income(input: IncomeVendorInput): Promise<IncomeVendorResponse>;
  nsopw(input: NsopwVendorInput): Promise<NsopwVendorResponse>;
  employment(input: EmploymentVendorInput): Promise<EmploymentVendorResponse>;
}
