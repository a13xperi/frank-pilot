// Screening Backtest Harness
//
// Replays synthetic applicants through the screening engine WITHOUT touching
// the production DB or any external vendor API. Pure local replay.
//
// Usage: MOCK_MODE=1 npx ts-node scripts/screening-backtest.ts
// Output: tmp/screening-backtest/<run-id>/{summary.md,per-applicant.csv}
//
// Safety:
//   - MOCK_MODE=1 is set at the top of this file before any service is
//     instantiated. The vendor services read process.env.MOCK_MODE at call
//     time and return canned responses keyed off screening_tag.
//   - ComplianceService and FraudDetectionService are NOT invoked — they
//     touch the real DB. Their behavior is simulated from corpus input
//     fields (ami_limit_cents, duplicate_ssn_hit).
//   - ScreeningService.runFullScreening() is NEVER called — it writes to
//     the applications table. The harness orchestrates the vendor services
//     directly and applies the same decision rules in-memory.

process.env.MOCK_MODE = "1";

import * as fs from "fs";
import * as path from "path";

import { BackgroundCheckService } from "../src/modules/screening/background-check";
import { CreditCheckService } from "../src/modules/screening/credit-check";
import { IdentityVerificationService } from "../src/modules/screening/identity-verification";
import { PlaidIncomeService } from "../src/modules/screening/income-verification-plaid";
// Phase 4a — extended fan-out adapters. Both join the screening parallel block
// behind SCREENING_EXTENDED_CHECKS_ENABLED in runFullScreening; the backtest
// gates their MOCK stub paths so a future SDK swap is verified the same way the
// original four are. NSOPW runs for every applicant; Work Number only when a
// W-2 employer was declared (design §3.3/§8.5).
import { NsopwDirectService } from "../src/modules/screening/nsopw-direct";
import { WorkNumberService } from "../src/modules/screening/work-number";
import {
  ScreeningState,
  canTransition,
  isTerminal,
} from "../src/modules/screening/state-machine";

interface SyntheticApplicant {
  id: string;
  screening_tag: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  ssn_last4: string;
  current_state: string;
  current_address_line1: string;
  current_city: string;
  annual_income_cents: number;
  household_size: number;
  ami_limit_cents: number | null;
  ami_area: string;
  duplicate_ssn_hit?: boolean;
  reported_annual_income_cents?: number;
  // Phase 4a — when true the Work Number (W-2) adapter runs. Mirrors
  // runFullScreening, which only calls Work Number when the applicant declared
  // an employer. Absent/false ⇒ Work Number is skipped for that applicant.
  declared_employer?: boolean;
  expected_outcome: "passed" | "failed" | "manual_review";
  expected_terminal_reason: string;
  notes?: string;
}

interface BacktestRow {
  applicantId: string;
  tag: string;
  expectedOutcome: string;
  actualOutcome: ScreeningState;
  match: boolean;
  terminalReason: string;
  expectedReason: string;
  reasonMatch: boolean;
  timeToDecisionMs: number;
  statePath: string;
  ruleFlags: string[];
}

interface BacktestSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalApplicants: number;
  outcomes: Record<string, number>;
  matchRate: number;
  reasonMatchRate: number;
  ruleFiringCounts: Record<string, number>;
  timeToDecisionMs: { mean: number; p50: number; p95: number };
  rows: BacktestRow[];
}

function loadCorpus(dir: string): SyntheticApplicant[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Corpus directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    return JSON.parse(raw) as SyntheticApplicant;
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function recordTransition(
  path: ScreeningState[],
  from: ScreeningState,
  to: ScreeningState
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Backtest produced invalid transition: ${from} -> ${to}`);
  }
  path.push(to);
}

async function runApplicant(
  app: SyntheticApplicant,
  bg: BackgroundCheckService,
  credit: CreditCheckService,
  identity: IdentityVerificationService,
  plaid: PlaidIncomeService,
  nsopw: NsopwDirectService,
  workNumber: WorkNumberService
): Promise<BacktestRow> {
  const startedAt = Date.now();
  const statePath: ScreeningState[] = ["queued"];
  const ruleFlags: string[] = [];
  let actualOutcome: ScreeningState = "queued";
  let terminalReason = "unknown";

  recordTransition(statePath, "queued", "id_verifying");

  const idResult = await identity.verify({
    firstName: app.first_name,
    lastName: app.last_name,
    dateOfBirth: app.date_of_birth,
    screeningTag: app.screening_tag,
  });

  if (idResult.result === "rejected") {
    recordTransition(statePath, "id_verifying", "failed");
    actualOutcome = "failed";
    terminalReason = "identity_verification_failed";
    ruleFlags.push("identity_rejected");
    return finishRow(app, statePath, actualOutcome, terminalReason, ruleFlags, startedAt);
  }
  if (idResult.result === "review_required") {
    recordTransition(statePath, "id_verifying", "manual_review");
    actualOutcome = "manual_review";
    terminalReason = "identity_verification_inconclusive";
    ruleFlags.push("identity_review");
    return finishRow(app, statePath, actualOutcome, terminalReason, ruleFlags, startedAt);
  }

  recordTransition(statePath, "id_verifying", "id_verified");
  recordTransition(statePath, "id_verified", "fraud_screening");

  if (app.duplicate_ssn_hit) {
    recordTransition(statePath, "fraud_screening", "failed");
    actualOutcome = "failed";
    terminalReason = "fraud_duplicate_ssn";
    ruleFlags.push("fraud_dup_ssn");
    return finishRow(app, statePath, actualOutcome, terminalReason, ruleFlags, startedAt);
  }

  recordTransition(statePath, "fraud_screening", "screening");

  const [bgResult, creditResult, plaidResult, nsopwResult, wn] = await Promise.all([
    bg.runCheck({
      firstName: app.first_name,
      lastName: app.last_name,
      ssnLast4: app.ssn_last4,
      dateOfBirth: app.date_of_birth,
      state: app.current_state,
      screeningTag: app.screening_tag,
    }),
    credit.runCheck({
      firstName: app.first_name,
      lastName: app.last_name,
      ssnLast4: app.ssn_last4,
      dateOfBirth: app.date_of_birth,
      screeningTag: app.screening_tag,
    }),
    plaid.verifyIncome({
      firstName: app.first_name,
      lastName: app.last_name,
      dateOfBirth: app.date_of_birth,
      screeningTag: app.screening_tag,
    }),
    // NSOPW direct — always (belt-and-suspenders for the §5.856 lifetime
    // mandatory denial). Internal catch returns review_required, so never throws.
    nsopw.check({
      firstName: app.first_name,
      lastName: app.last_name,
      dateOfBirth: app.date_of_birth,
      states: [app.current_state],
      screeningTag: app.screening_tag,
    }),
    // Work Number — only when a W-2 employer was declared. work-number.ts has
    // NO internal catch (P1 fail-loud contract); contain the throw here exactly
    // as runFullScreening does so a single adapter can't abort the replay.
    app.declared_employer
      ? workNumber
          .verifyEmployment({
            firstName: app.first_name,
            lastName: app.last_name,
            ssn: app.ssn_last4,
            dateOfBirth: app.date_of_birth,
          })
          .then((value) => ({ ok: true as const, value }))
          .catch((error: Error) => ({ ok: false as const, error }))
      : Promise.resolve(null),
  ]);

  // NSOPW: match → fail (mandatory denial); no_match → pass; else review_required.
  const nsopwVerdict: "pass" | "fail" | "review_required" =
    nsopwResult.result === "match"
      ? "fail"
      : nsopwResult.result === "no_match"
        ? "pass"
        : "review_required";

  // Work Number: verified → pass; other verdicts → review_required; a thrown
  // adapter → could_not_screen HOLD (routed to manual_review). Null when skipped.
  // MOCK_MODE never throws, so could_not_screen is exercised by the unit suite,
  // not this corpus — kept here only to mirror runFullScreening faithfully.
  let wnVerdict: "pass" | "review_required" | "could_not_screen" | null = null;
  if (wn) {
    if (wn.ok) {
      wnVerdict = wn.value.result === "verified" ? "pass" : "review_required";
    } else {
      wnVerdict = "could_not_screen";
      ruleFlags.push("work_number_could_not_screen");
    }
  }

  // Simulated compliance check — deterministic against the corpus's declared
  // AMI limit, since ComplianceService reads the live DB.
  let complianceVerdict: "pass" | "fail" | "review_required";
  if (app.ami_limit_cents === null) {
    complianceVerdict = "review_required";
  } else if (plaidResult.annualIncomeCents > app.ami_limit_cents) {
    complianceVerdict = "fail";
  } else {
    complianceVerdict = "pass";
  }

  // Simulated income-mismatch check — runs after Plaid returns (cross-check is
  // guarded on a verified Plaid figure, as in runFullScreening). The reported
  // baseline is the Work Number W-2 figure when WN verified, otherwise the
  // corpus's declared reported income. A >15% delta from Plaid fires a fraud
  // flag and routes to manual_review.
  let incomeMismatch = false;
  if (plaidResult.result === "verified") {
    let reportedCents: number | undefined;
    if (wn && wn.ok && wn.value.result === "verified" && wn.value.details.annualizedIncome) {
      reportedCents = wn.value.details.annualizedIncome * 100;
    } else if (
      app.reported_annual_income_cents !== undefined &&
      app.reported_annual_income_cents > 0
    ) {
      reportedCents = app.reported_annual_income_cents;
    }
    if (reportedCents !== undefined && reportedCents > 0) {
      const verifiedCents = plaidResult.annualIncomeCents;
      const delta = Math.abs(reportedCents - verifiedCents) / reportedCents;
      if (delta > 0.15) {
        incomeMismatch = true;
        ruleFlags.push("fraud_income_mismatch");
      }
    }
  }

  if (bgResult.result === "fail") ruleFlags.push("background_fail");
  if (creditResult.result === "fail") ruleFlags.push("credit_fail");
  if (complianceVerdict === "fail") ruleFlags.push("compliance_fail_over_ami");
  if (nsopwVerdict === "fail") ruleFlags.push("nsopw_match");
  if (bgResult.result === "review_required") ruleFlags.push("background_review");
  if (creditResult.result === "review_required") ruleFlags.push("credit_review");
  if (complianceVerdict === "review_required") ruleFlags.push("compliance_review_no_ami");
  if (nsopwVerdict === "review_required") ruleFlags.push("nsopw_review");
  if (wnVerdict === "review_required") ruleFlags.push("work_number_review");

  const results: Array<"pass" | "fail" | "review_required" | "could_not_screen"> = [
    bgResult.result,
    creditResult.result,
    complianceVerdict,
    nsopwVerdict,
    ...(wnVerdict ? [wnVerdict] : []),
  ];

  if (results.includes("fail")) {
    recordTransition(statePath, "screening", "failed");
    actualOutcome = "failed";
    if (bgResult.result === "fail") {
      terminalReason = bgResult.details.sexOffenses
        ? "background_fail_sex_offender"
        : bgResult.details.violentCrimes
          ? "background_fail_violent"
          : "background_fail_felony";
    } else if (creditResult.result === "fail") {
      terminalReason = "credit_fail";
    } else if (nsopwVerdict === "fail") {
      terminalReason = "nsopw_match_sex_offender";
    } else {
      terminalReason = "compliance_fail_over_ami";
    }
  } else if (results.includes("could_not_screen")) {
    // A vendor threw — no verdict. Never a silent pass: HOLD for staff review.
    recordTransition(statePath, "screening", "manual_review");
    actualOutcome = "manual_review";
    terminalReason = "could_not_screen_hold";
  } else if (incomeMismatch || results.includes("review_required")) {
    recordTransition(statePath, "screening", "manual_review");
    actualOutcome = "manual_review";
    if (incomeMismatch) {
      terminalReason = "fraud_income_mismatch";
    } else if (bgResult.result === "review_required") {
      terminalReason = "background_review_misdemeanors";
    } else if (creditResult.result === "review_required") {
      terminalReason = "credit_review_low_score";
    } else if (nsopwVerdict === "review_required") {
      terminalReason = "nsopw_review_inconclusive";
    } else if (wnVerdict === "review_required") {
      terminalReason = "work_number_review_inconclusive";
    } else {
      terminalReason = "compliance_review_no_ami_data";
    }
  } else {
    recordTransition(statePath, "screening", "passed");
    actualOutcome = "passed";
    terminalReason = "all_checks_passed";
  }

  return finishRow(app, statePath, actualOutcome, terminalReason, ruleFlags, startedAt);
}

function finishRow(
  app: SyntheticApplicant,
  statePath: ScreeningState[],
  actualOutcome: ScreeningState,
  terminalReason: string,
  ruleFlags: string[],
  startedAt: number
): BacktestRow {
  if (!isTerminal(actualOutcome) && actualOutcome !== "manual_review") {
    throw new Error(
      `Backtest finished in non-terminal state ${actualOutcome} for ${app.id}`
    );
  }
  return {
    applicantId: app.id,
    tag: app.screening_tag,
    expectedOutcome: app.expected_outcome,
    actualOutcome,
    match: actualOutcome === app.expected_outcome,
    terminalReason,
    expectedReason: app.expected_terminal_reason,
    reasonMatch: terminalReason === app.expected_terminal_reason,
    timeToDecisionMs: Date.now() - startedAt,
    statePath: statePath.join(" -> "),
    ruleFlags,
  };
}

function buildSummary(runId: string, startedAt: string, rows: BacktestRow[]): BacktestSummary {
  const finishedAt = new Date().toISOString();
  const outcomes: Record<string, number> = {};
  const ruleFiringCounts: Record<string, number> = {};
  for (const row of rows) {
    outcomes[row.actualOutcome] = (outcomes[row.actualOutcome] || 0) + 1;
    for (const flag of row.ruleFlags) {
      ruleFiringCounts[flag] = (ruleFiringCounts[flag] || 0) + 1;
    }
  }
  const matchCount = rows.filter((r) => r.match).length;
  const reasonMatchCount = rows.filter((r) => r.reasonMatch).length;
  const times = rows.map((r) => r.timeToDecisionMs).sort((a, b) => a - b);
  const mean = times.length === 0 ? 0 : times.reduce((s, x) => s + x, 0) / times.length;
  return {
    runId,
    startedAt,
    finishedAt,
    totalApplicants: rows.length,
    outcomes,
    matchRate: rows.length === 0 ? 0 : matchCount / rows.length,
    reasonMatchRate: rows.length === 0 ? 0 : reasonMatchCount / rows.length,
    ruleFiringCounts,
    timeToDecisionMs: {
      mean: Math.round(mean * 100) / 100,
      p50: percentile(times, 50),
      p95: percentile(times, 95),
    },
    rows,
  };
}

function renderSummaryMd(s: BacktestSummary): string {
  const lines: string[] = [];
  lines.push(`# Screening Backtest Run ${s.runId}`);
  lines.push("");
  lines.push(`Started:  ${s.startedAt}`);
  lines.push(`Finished: ${s.finishedAt}`);
  lines.push(`Total applicants: ${s.totalApplicants}`);
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  lines.push("| Outcome | Count | Share |");
  lines.push("|---|---|---|");
  for (const [k, v] of Object.entries(s.outcomes)) {
    const pct = s.totalApplicants === 0 ? 0 : (v / s.totalApplicants) * 100;
    lines.push(`| ${k} | ${v} | ${pct.toFixed(1)}% |`);
  }
  lines.push("");
  lines.push("## Match Rates");
  lines.push("");
  lines.push(`- Outcome match: ${(s.matchRate * 100).toFixed(1)}%`);
  lines.push(`- Reason match: ${(s.reasonMatchRate * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("## Time to Decision");
  lines.push("");
  lines.push(`- Mean: ${s.timeToDecisionMs.mean} ms`);
  lines.push(`- p50:  ${s.timeToDecisionMs.p50} ms`);
  lines.push(`- p95:  ${s.timeToDecisionMs.p95} ms`);
  lines.push("");
  lines.push("## Rule Firing Counts");
  lines.push("");
  if (Object.keys(s.ruleFiringCounts).length === 0) {
    lines.push("(no rules fired)");
  } else {
    lines.push("| Rule | Count |");
    lines.push("|---|---|");
    for (const [k, v] of Object.entries(s.ruleFiringCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${k} | ${v} |`);
    }
  }
  lines.push("");
  lines.push("## Per-Applicant Results");
  lines.push("");
  lines.push("| Applicant | Tag | Expected | Actual | Match | Reason | Reason Match | ms | Path |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const row of s.rows) {
    lines.push(
      `| ${row.applicantId} | ${row.tag} | ${row.expectedOutcome} | ${row.actualOutcome} | ${row.match ? "yes" : "NO"} | ${row.terminalReason} | ${row.reasonMatch ? "yes" : "NO"} | ${row.timeToDecisionMs} | ${row.statePath} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function escapeCsv(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function renderCsv(rows: BacktestRow[]): string {
  const header = [
    "applicant_id",
    "tag",
    "expected_outcome",
    "actual_outcome",
    "match",
    "expected_reason",
    "actual_reason",
    "reason_match",
    "time_to_decision_ms",
    "state_path",
    "rule_flags",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escapeCsv(row.applicantId),
        escapeCsv(row.tag),
        escapeCsv(row.expectedOutcome),
        escapeCsv(row.actualOutcome),
        row.match ? "true" : "false",
        escapeCsv(row.expectedReason),
        escapeCsv(row.terminalReason),
        row.reasonMatch ? "true" : "false",
        String(row.timeToDecisionMs),
        escapeCsv(row.statePath),
        escapeCsv(row.ruleFlags.join("|")),
      ].join(",")
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (process.env.MOCK_MODE !== "1") {
    console.error("FATAL: MOCK_MODE must be 1. This harness must never call real vendors.");
    process.exit(1);
  }

  const corpusDir = path.join(__dirname, "screening-backtest-corpus");
  const corpus = loadCorpus(corpusDir);
  if (corpus.length === 0) {
    console.error(`No corpus entries found in ${corpusDir}`);
    process.exit(1);
  }

  const bg = new BackgroundCheckService();
  const credit = new CreditCheckService();
  const identity = new IdentityVerificationService();
  const plaid = new PlaidIncomeService();
  const nsopw = new NsopwDirectService();
  const workNumber = new WorkNumberService();

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const startedAt = new Date().toISOString();
  const outDir = path.join(process.cwd(), "tmp", "screening-backtest", runId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Backtest run ${runId} — ${corpus.length} applicants`);
  console.log(`Output: ${outDir}`);

  const rows: BacktestRow[] = [];
  for (const app of corpus) {
    const row = await runApplicant(app, bg, credit, identity, plaid, nsopw, workNumber);
    rows.push(row);
    const tick = row.match ? "ok" : "MISMATCH";
    console.log(
      `  [${tick}] ${row.applicantId} expected=${row.expectedOutcome} actual=${row.actualOutcome} reason=${row.terminalReason}`
    );
  }

  const summary = buildSummary(runId, startedAt, rows);
  fs.writeFileSync(path.join(outDir, "summary.md"), renderSummaryMd(summary), "utf8");
  fs.writeFileSync(path.join(outDir, "per-applicant.csv"), renderCsv(rows), "utf8");

  console.log("");
  console.log(`Match rate:        ${(summary.matchRate * 100).toFixed(1)}%`);
  console.log(`Reason match rate: ${(summary.reasonMatchRate * 100).toFixed(1)}%`);
  console.log(`Outcomes:          ${JSON.stringify(summary.outcomes)}`);
  console.log(`Wrote ${path.join(outDir, "summary.md")}`);
  console.log(`Wrote ${path.join(outDir, "per-applicant.csv")}`);

  if (summary.matchRate < 1.0) {
    console.error("");
    console.error("FAIL: not all applicants matched expected outcome");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Backtest run failed:", err);
  process.exit(1);
});
