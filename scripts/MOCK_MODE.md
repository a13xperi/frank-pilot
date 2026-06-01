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
| NsopwDirectService | yes | direct gov source (NSOPW.gov) — always runs |
| WorkNumberService | yes | external vendor (Equifax) — runs only when `declared_employer` is true |
| ComplianceService | NO | deterministic against the local AMI table; mock at the input-data layer instead |
| FraudDetectionService | NO | local DB heuristics; mock at the input-data layer instead |

## Tag-to-response contract

The corpus at `scripts/screening-backtest-corpus/*.json` defines 10
canonical edge cases. Each corpus entry has a `screening_tag` field. Tags
in current use:

| Tag | bg | credit | identity | plaid income | nsopw |
|---|---|---|---|---|---|
| `approve_clean` | pass (no records) | pass (720) | verified | verified ($54k/yr) | no_match |
| `deny_felony` | fail (1 felony) | pass (680) | verified | verified ($54k/yr) | no_match |
| `deny_sex_offender` | fail (lifetime registry) | pass (680) | verified | verified ($54k/yr) | **match** |
| `deny_income_over_ami` | pass | pass (680) | verified | verified ($90k/yr) | no_match |
| `review_misdemeanors` | review (3 misdemeanors, risk 75) | pass (680) | verified | verified ($54k/yr) | no_match |
| `review_low_credit` | pass | review (520) | verified | verified ($54k/yr) | no_match |
| `fraud_dup_ssn` | (early exit — never reaches) | (early exit) | (early exit) | (early exit) | (early exit) |
| `fraud_income_mismatch` | pass | pass (680) | verified | verified ($30k/yr — mismatch against $90k claim) | no_match |
| `no_ami_data` | pass | pass (680) | verified | verified ($54k/yr) | no_match |
| `id_verification_fail` | (skipped) | (skipped) | rejected | (skipped) | (skipped) |

NSOPW keys off the same `screening_tag` as background — `deny_sex_offender` is the
only tag that returns a `match` (the §5.856 lifetime registry case), so NSOPW
acts as a belt-and-suspenders confirmation of the background denial there.

**Work Number** does not branch on `screening_tag`; in MOCK it always returns
`verified` with a $45k/yr W-2 figure. It runs only for corpus entries with
`"declared_employer": true`. When it verifies, the income cross-check reconciles
its W-2 figure against Plaid (a >15% delta ⇒ `fraud_income_mismatch` ⇒
manual_review), mirroring `runFullScreening`. Its keyless-prod throw → 
`could_not_screen` HOLD path is fail-loud and is covered by the unit suite
(`screening-extended-checks.test.ts`), not by this MOCK corpus.

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
