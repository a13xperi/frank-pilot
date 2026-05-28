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
  plaid: PlaidIncomeService
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

  const [bgResult, creditResult, plaidResult] = await Promise.all([
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
  ]);

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

  // Simulated income-mismatch check — runs after Plaid returns. If the
  // applicant's reported income differs from Plaid's verified income by
  // >15%, fire a fraud flag and route to manual_review.
  let incomeMismatch = false;
  if (
    app.reported_annual_income_cents !== undefined &&
    app.reported_annual_income_cents > 0
  ) {
    const reportedCents = app.reported_annual_income_cents;
    const verifiedCents = plaidResult.annualIncomeCents;
    const delta = Math.abs(reportedCents - verifiedCents) / reportedCents;
    if (delta > 0.15) {
      incomeMismatch = true;
      ruleFlags.push("fraud_income_mismatch");
    }
  }

  if (bgResult.result === "fail") ruleFlags.push("background_fail");
  if (creditResult.result === "fail") ruleFlags.push("credit_fail");
  if (complianceVerdict === "fail") ruleFlags.push("compliance_fail_over_ami");
  if (bgResult.result === "review_required") ruleFlags.push("background_review");
  if (creditResult.result === "review_required") ruleFlags.push("credit_review");
  if (complianceVerdict === "review_required") ruleFlags.push("compliance_review_no_ami");

  const results = [bgResult.result, creditResult.result, complianceVerdict];

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
    } else {
      terminalReason = "compliance_fail_over_ami";
    }
  } else if (incomeMismatch || results.includes("review_required")) {
    recordTransition(statePath, "screening", "manual_review");
    actualOutcome = "manual_review";
    if (incomeMismatch) {
      terminalReason = "fraud_income_mismatch";
    } else if (bgResult.result === "review_required") {
      terminalReason = "background_review_misdemeanors";
    } else if (creditResult.result === "review_required") {
      terminalReason = "credit_review_low_score";
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
        row.applicantId,
        row.tag,
        row.expectedOutcome,
        row.actualOutcome,
        row.match ? "true" : "false",
        row.expectedReason,
        row.terminalReason,
        row.reasonMatch ? "true" : "false",
        String(row.timeToDecisionMs),
        `"${row.statePath}"`,
        `"${row.ruleFlags.join("|")}"`,
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

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const startedAt = new Date().toISOString();
  const outDir = path.join(process.cwd(), "tmp", "screening-backtest", runId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Backtest run ${runId} — ${corpus.length} applicants`);
  console.log(`Output: ${outDir}`);

  const rows: BacktestRow[] = [];
  for (const app of corpus) {
    const row = await runApplicant(app, bg, credit, identity, plaid);
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
