# MOCK_MODE — Screening Backtest Vendor Mock Contract

`MOCK_MODE=1` is a process-wide env gate that switches the screening vendor
services into mock-mode. When set, each service reads a `screeningTag` field
on its input and returns a canned response keyed off the tag. Production
never sets `MOCK_MODE=1`.

The backtest harness (`scripts/screening-backtest.ts`) is the only caller
that sets this env. If any vendor service ever receives a real applicant
call from the harness (i.e., with no tag set, or against the real DB),
that is a bug.

## Which services honor MOCK_MODE

| Service | Honors MOCK_MODE? | Why |
|---|---|---|
| BackgroundCheckService | yes | external vendor (Checkr) |
| CreditCheckService | yes | external vendor (TransUnion ShareAble) |
| IdentityVerificationService | yes | external vendor (Persona) |
| PlaidIncomeService | yes | external vendor (Plaid) |
| WorkNumberService (PR #201) | yes (planned) | external vendor (Equifax) |
| ComplianceService | NO | deterministic against the local AMI table; mock at the input-data layer instead |
| FraudDetectionService | NO | local DB heuristics; mock at the input-data layer instead |

## Tag-to-response contract

The corpus at `scripts/screening-backtest-corpus/*.json` defines 10
canonical edge cases. Each corpus entry has a `screening_tag` field. Tags
in current use:

| Tag | bg | credit | identity | plaid income |
|---|---|---|---|---|
| `approve_clean` | pass (no records) | pass (720) | verified | verified ($54k/yr) |
| `deny_felony` | fail (1 felony) | pass (680) | verified | verified ($54k/yr) |
| `deny_sex_offender` | fail (lifetime registry) | pass (680) | verified | verified ($54k/yr) |
| `deny_income_over_ami` | pass | pass (680) | verified | verified ($90k/yr) |
| `review_misdemeanors` | review (3 misdemeanors, risk 75) | pass (680) | verified | verified ($54k/yr) |
| `review_low_credit` | pass | review (520) | verified | verified ($54k/yr) |
| `fraud_dup_ssn` | (early exit — never reaches) | (early exit) | (early exit) | (early exit) |
| `fraud_income_mismatch` | pass | pass (680) | verified | verified ($30k/yr — mismatch against $90k claim) |
| `no_ami_data` | pass | pass (680) | verified | verified ($54k/yr) |
| `id_verification_fail` | (skipped) | (skipped) | rejected | (skipped) |

## How to add a new tag

1. Add a new JSON file to `scripts/screening-backtest-corpus/` with a new
   `screening_tag` value.
2. Extend the `mockResponse(tag)` method in each relevant service to
   return a canned response for that tag.
3. Add a row to the table above.
4. Run `MOCK_MODE=1 npx ts-node scripts/screening-backtest.ts` and confirm
   the harness picks up the new entry.

## Safety

- Never set `MOCK_MODE=1` in any non-local environment.
- Never commit a `.env` that sets `MOCK_MODE=1`.
- The harness itself sets the env at the top of its file and never clears
  it (process exits at the end), so cross-test contamination is impossible.
