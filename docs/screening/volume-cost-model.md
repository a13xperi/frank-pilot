# Screening volume + unit-economics model

> **Status:** Skeleton. Fill in once Frank delivers portfolio turnover rate (Section 1 of `docs/onboarding/frank-credentials-request.md`) and vendor RFQ responses arrive (Section 2b → 2d).
> **Purpose:** validate that the $35.95 / adult application fee covers vendor cost + ≥40% margin.

---

## 1. Inputs (fill in)

| Variable                                  | Source                                              | Value |
| ----------------------------------------- | --------------------------------------------------- | ----- |
| Total units in Frank's portfolio          | Frank (or already-known: ~1,600)                    | _[#]_ |
| Annual turnover rate                      | Frank (Section 1 of credentials request)            | _[%]_ |
| Avg adults per application                | Frank, or assume 1.4 (industry norm for affordable) | _[#]_ |
| Application fee (per adult)               | Set                                                  | $35.95 |
| Annual applications (turnover × multiplier) | Calculated — see § 2                              | _[#]_ |

**Multiplier note:** annual applications > annual turnover because (a) some applications are denied + re-submitted and (b) some units get multiple applicants before one is approved. Industry rule of thumb: 1.3–1.8× turnover. Default to **1.5×** unless Frank has historical data.

---

## 2. Volume math

```
annual_units_turning_over    = total_units × turnover_rate
annual_applications          = annual_units_turning_over × application_multiplier (1.5×)
annual_adult_applications    = annual_applications × avg_adults_per_application
monthly_adult_applications   = annual_adult_applications / 12
```

| Output                          | Formula                                       | Value |
| ------------------------------- | --------------------------------------------- | ----- |
| Annual unit turnover            | 1,600 × _[%]_                                 | _[#]_ |
| Annual applications             | (above) × 1.5                                 | _[#]_ |
| Annual adult-applications       | (above) × _[adults/app]_                      | _[#]_ |
| **Monthly adult-applications**  | (annual) ÷ 12                                 | _[#]_ |

This is the number used to size vendor contracts (most vendors price per check, some have monthly minimums).

---

## 3. Per-applicant cost stack (fill from vendor RFQ responses)

| Cost component                          | Vendor A (Equifax+Checkr) | Vendor B (TransUnion SmartMove) | Vendor C (Experian RentBureau) |
| --------------------------------------- | ------------------------- | -------------------------------- | ------------------------------ |
| Background check (criminal + eviction)  | $_                        | $_                               | $_                             |
| Credit report                           | $_                        | $_                               | $_                             |
| Income verification (Work Number / equiv) | $_                      | $_                               | $_                             |
| Identity verification                   | $_                        | $_                               | $_                             |
| Per-applicant total                     | **$_**                    | **$_**                           | **$_**                         |
| Monthly minimum (if any)                | $_                        | $_                               | $_                             |
| Setup / credentialing fee               | $_                        | $_                               | $_                             |

Add Resend + Twilio per-applicant marginal costs (~$0.02 total — trivial, ignore unless we hit 50k+/yr).

---

## 4. Unit-economics output

For each vendor, compute:

```
net_per_applicant     = $35.95 − per_applicant_total
margin_pct            = net_per_applicant / $35.95
monthly_revenue       = monthly_adult_applications × $35.95
monthly_vendor_cost   = max(monthly_adult_applications × per_applicant_total, monthly_minimum)
monthly_net           = monthly_revenue − monthly_vendor_cost
```

| Output                         | Vendor A | Vendor B | Vendor C |
| ------------------------------ | -------- | -------- | -------- |
| Net per applicant              | $_       | $_       | $_       |
| Margin %                       | _%       | _%       | _%       |
| Monthly revenue                | $_       | $_       | $_       |
| Monthly vendor cost            | $_       | $_       | $_       |
| **Monthly net (margin $)**     | $_       | $_       | $_       |

**Pass criterion:** margin ≥ 40% per applicant **and** monthly net covers fixed compliance overhead (FCRA letter generation, adverse-action handling, manual-review staff time — assume $500/mo placeholder until Frank confirms).

---

## 5. Sensitivity scenarios

Once filled, compute net under:
- **Worst-case turnover** (Frank's number − 5pp)
- **Best-case turnover** (Frank's number + 5pp)
- **Vendor price increase** (+20%)
- **Denial-driven re-application multiplier 1.8×** (high-churn scenario)

If margin drops below 25% in any worst-case scenario, escalate fee to $39.95 or $44.95 before launch.

---

## 6. Decision criteria for Section 2d (vendor pick)

Vendor selection is **not purely lowest-cost**:

- ✅ Margin ≥ 40% at base case AND ≥ 25% at worst case
- ✅ All 4 check types (BG / credit / income / ID) under one contract OR clean API integration if bundled across two
- ✅ FCRA compliance certified (BG + credit vendors only — Work Number is separate)
- ✅ Onboarding turnaround ≤ 6 weeks
- ✅ API maturity (REST + webhooks, not batch FTP)

Whichever vendor wins on these gates, even if not absolute cheapest, is the choice.

---

## 7. Output for Section 2d scoring

Feed the per-vendor totals from § 4 into `docs/screening/vendor-scoring-matrix.md` (companion doc) as the "cost" weight.
