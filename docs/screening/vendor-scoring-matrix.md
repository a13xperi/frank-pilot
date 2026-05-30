# Screening vendor scoring matrix

> **Status:** Template. Fill scores once all 4 RFQ responses arrive (typically 1-2 weeks after sending the cover paragraphs from `vendor-rfq-template.md`).
> **Companion:** `volume-cost-model.md` (for the cost row).
> **Output:** signed contract with chosen vendor → kick off credentialing (Section 2d → 2e of master plan).

---

## How to use this matrix

1. Score each vendor 0–10 on each row (10 = best in category, 0 = unacceptable).
2. Multiply by the weight to get weighted score.
3. Sum the weighted column. Highest weighted total wins.
4. **Veto rules:** any vendor scoring 0 on a "gate" row (marked ⚠️) is eliminated regardless of total.

---

## Matrix

| Criterion                                              | Weight | Equifax + Checkr | TransUnion SmartMove | Experian RentBureau | Notes / source           |
| ------------------------------------------------------ | ------ | ---------------- | -------------------- | ------------------- | ------------------------ |
| **Per-applicant cost** (from volume-cost-model § 4)    | 20     | _/10             | _/10                 | _/10                | Lower cost = higher score |
| **All 4 checks under one contract** ⚠️ gate           | 15     | _/10             | _/10                 | _/10                | BG / credit / income / ID — split contracts = 5 cap |
| **API maturity** (REST + webhooks vs. batch FTP) ⚠️   | 10     | _/10             | _/10                 | _/10                | Batch FTP = 0; gates vendor out |
| **FCRA compliance posture**                            | 10     | _/10             | _/10                 | _/10                | Adverse-action letter API? Dispute handling? |
| **Onboarding turnaround**                              | 8      | _/10             | _/10                 | _/10                | ≤4wk=10, ≤6wk=7, ≤8wk=5, >8wk=2 |
| **Criminal data depth + recency**                      | 10     | _/10             | _/10                 | _/10                | County + state + federal? Refresh cadence? |
| **Credit data freshness + scoring**                    | 8      | _/10             | _/10                 | _/10                | FICO 9+? Real-time pull? |
| **Income verification (Work Number / equiv)**          | 8      | _/10             | _/10                 | _/10                | Equifax owns Work Number → likely scores 10 here |
| **NSOPW coverage** (bundled or independent)            | 4      | _/10             | _/10                 | _/10                | If not bundled, we wire NSOPW directly (free) — score 5 floor |
| **Customer support + account manager quality**         | 4      | _/10             | _/10                 | _/10                | Dedicated rep? SLA? |
| **Contract terms** (length, exit, price escalation)    | 3      | _/10             | _/10                 | _/10                | 12mo with 30-day exit = 10; 36mo lock = 3 |
| **Total weight**                                       | 100    |                  |                      |                     |                          |
| **Weighted total**                                     | —      | _                | _                    | _                   | Sum of (score × weight) / 10 |

---

## Veto-check (gate rows)

- ⚠️ **All 4 checks under one contract:** if vendor scores 0 here, eliminate unless we can pair them cleanly with a second vendor that fills the gap (e.g., Checkr for BG + Experian for credit). Surface as decision point.
- ⚠️ **API maturity:** if vendor scores 0 (batch FTP only), eliminate. We can't run a modern applicant funnel on overnight batch.

---

## After the matrix

- Highest weighted total + passes vetoes = **the chosen vendor**.
- Sign contract.
- Request credentialing kickoff packet (typically takes 2-6 weeks for them to provision API keys + FCRA-compliance review of our use case).
- During credentialing wait: implement vendor SDK in `src/modules/screening/{background-check,credit-check}.ts` per Section 2e of the master plan.

---

## Notes for live scoring

- Equifax+Checkr likely dominates on cost + Work Number availability but may lose on API maturity (Equifax direct API is older than Checkr's).
- TransUnion SmartMove is the SMB-friendly choice — best onboarding turnaround, weaker on enterprise SLAs.
- Experian RentBureau has the best rental-specific data but worst overall API ergonomics historically.

These are priors, not predictions — fill the matrix from actual RFQ responses, not vibes.
