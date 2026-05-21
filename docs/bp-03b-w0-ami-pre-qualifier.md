# BP-03b — W0: AMI Pre-Qualifier (one-pager)

**Status:** Proposal — not yet implemented.
**Author:** Alex / Claude.
**Last updated:** 2026-05-20.
**Related:** [`docs/intel/gpmglv-audit.md`](intel/gpmglv-audit.md), [`docs/intel/gpmglv-bp-03b-positioning.md`](intel/gpmglv-bp-03b-positioning.md).

---

## Problem

LIHTC / affordable inventory has **income caps** (30/50/60/80% AMI bands). Today our wizard collects income at Step 2 (`Step2Details.tsx`) and at review-time displays a **hardcoded** band:

> `client-tenant/src/pages/apply/steps/StepReview.tsx:22-35` — `incomeBand = '50–60% AMI'`

That string is a lie. Nothing is computed. Two failures cascade:

1. **Demo lie** — the review card says "you qualify for 50–60% AMI" regardless of input.
2. **Operator risk** — an applicant who is over-income can finish the flow, pay the $35.95 screening fee, and then get rejected at compliance. Refund + churn + brand damage.

GPMGLV's site has the same problem (no upfront eligibility check — they collect leads then sort later — see audit §Gaps). That's our wedge: **qualify in 30 seconds, before anyone fills out a form**.

---

## Goal

A **pre-qualifier** that, given `householdSize` + `grossAnnualIncome` + property AMI table, returns:

- The applicant's **qualifying AMI tier** (`'30' | '50' | '60' | '80' | null`).
- A list of currently-listable units they're **eligible for** (income at-or-under cap).
- A friendly "you don't qualify here, here's the waitlist" path when the answer is null.

The pre-qualifier is the **front door**, not the back of the form.

---

## Two design options

### Option A — Discrete W0 step (breaks FROZEN CONTRACT 1)

Insert a new step at the very front of `Apply.tsx`:

```
0:qualify → 1:register → verify → intent → checklist → pick → claim → [review|2] → household → payment → confirm
```

| Pros | Cons |
| --- | --- |
| Clean separation, isolated component | Breaks FROZEN CONTRACT 1 (step order) — touches `parseStep`, `setStep`, all 9 step files, `WizardTestProvider`, deep-link logic |
| Easy to A/B (set as an entry route variant) | Adds friction *before* email capture → real conversion risk |
| Trackable as its own funnel event | Requires schema bump for `qualifyingAmiTier` |

### Option B — Inline AMI calculator + Intent-step hook (recommended)

Don't add a step. Add two surfaces that share one calculator:

1. **Landing page widget** — `/` gets an "Am I eligible?" card with collapsible inline calculator. Renders **before** the applicant commits to anything. Anonymous, no auth.
2. **Intent step embed** — `StepIntent.tsx` already collects `intentBedrooms / intentBudgetMax / intentMoveInDate / intentHouseholdSize`. Add a single field (`grossAnnualIncome`) + a live AMI-tier badge. On submit, persist `qualifyingAmiTier` to `ApplyState`.
3. **Pick step filtering** — `StepPick.tsx` (`/applicants/units?amiTier=<tier>`) filters units to only those at-or-under the applicant's qualifying tier. Out-of-tier units appear in a collapsed "Other units (income cap too low)" section.
4. **Review step replacement** — `StepReview.tsx:22-35` swaps the hardcoded `'50–60% AMI'` string for `useWizState()`-derived `qualifyingAmiTier`.

| Pros | Cons |
| --- | --- |
| Respects FROZEN CONTRACT 1 (no step-order churn) | Calculator logic lives in two places (landing + intent) — small duplication |
| Pre-qualification happens **before** identity capture (anonymous front door) | No isolated funnel event — must instrument with a custom analytics event |
| Re-uses existing Intent step UX | If applicant skips landing widget and goes straight to apply, the tier is computed at Intent (still upstream of payment) |
| Single new field on Intent (gross income) — small contract delta | Requires AMI table + computation function as new shared lib |

**Recommendation:** Option B. The frozen step contract exists for a reason (tests, deep links, tape integration), and the UX benefit of W0 doesn't require a discrete step — it requires that the *answer* exist before the applicant pays. Inlining hits the same outcome without breaking the contract.

---

## Surface map (Option B)

```
Landing page (/)
  └─ <AmiCalculator />          ← anonymous, optional, returns tier locally
                                  No PII written to server. Persists to
                                  sessionStorage only if applicant clicks
                                  "Find units for my tier".

Apply wizard
  StepIntent (existing)
    ├─ existing fields (bedrooms, budget, move-in, household size)
    └─ NEW: <AmiCalculator inline mode="apply" />
              ↓ on calculate → sets qualifyingAmiTier in ApplyState
  StepPick (existing)
    └─ fetches /applicants/units?amiTier=<tier>&...
              ↓ unit list pre-filtered to eligible tiers
  StepReview (existing)
    └─ displays qualifyingAmiTier (replaces hardcoded "50–60% AMI")
              ↓ NEW: "Confirm income" microcopy + edit link back to Intent
```

---

## Data model (additions)

**`ApplyState`** — `client-tenant/src/pages/apply/context/ApplyContext.tsx:61-120`:

```ts
// add to ApplyState
qualifyingAmiTier: '30' | '50' | '60' | '80' | null;
grossAnnualIncome: number | null;          // moved upstream from Step2Details
qualifyingAmiCalculatedAt: string | null;  // ISO timestamp, for staleness
qualifyingHouseholdSize: number | null;    // snapshot at time of calculation
```

Persists via existing `useWizState`/`sessionStorage` machinery — no new contract surface, just additive fields.

**AMI table** — new `client-tenant/src/lib/ami.ts`:

```ts
// HUD-published income limits, scoped to property's MSA.
// Initial coverage: Las Vegas–Henderson–Paradise MSA (gpmglv target).
// Subsequent MSAs added as properties onboard.
export const AMI_TABLES = {
  'LAS_VEGAS_HENDERSON': {
    year: 2026,
    // householdSize → { 30%, 50%, 60%, 80% } annual income caps
    1: { '30': 19_400, '50': 32_350, '60': 38_820, '80': 51_750 },
    2: { '30': 22_200, '50': 36_950, '60': 44_340, '80': 59_100 },
    // ... up to size 8
  },
} as const;

export function qualifyAmiTier(
  msa: keyof typeof AMI_TABLES,
  householdSize: number,
  grossAnnualIncome: number,
): '30' | '50' | '60' | '80' | null { /* ... */ }
```

**Server side** — `/applicants/units` accepts `?amiTier=<tier>` and filters to units whose income cap is **at or above** the applicant's tier (i.e. tier 50 applicant qualifies for 50/60/80% units). Owner: backend lane, not part of this slice — flag as dependency.

---

## Implementation map

**New:**
- `client-tenant/src/lib/ami.ts` — AMI table + `qualifyAmiTier()` function + unit tests.
- `client-tenant/src/components/AmiCalculator.tsx` — embeddable component with `mode: 'standalone' | 'inline'` prop.
- `client-tenant/src/components/__tests__/AmiCalculator.test.tsx`.

**Edited:**
- `client-tenant/src/pages/apply/context/ApplyContext.tsx` — add 4 fields above to `ApplyState`.
- `client-tenant/src/pages/apply/steps/StepIntent.tsx` — embed `<AmiCalculator mode="inline" />`, capture `grossAnnualIncome` + `qualifyingAmiTier`, persist on submit.
- `client-tenant/src/pages/apply/steps/StepPick.tsx` — pass `amiTier` to `/applicants/units` fetch.
- `client-tenant/src/pages/apply/steps/StepReview.tsx:22-35` — replace hardcoded `incomeBand` with `useWizState().qualifyingAmiTier`.
- Landing page (find route; mount `<AmiCalculator mode="standalone" />` above-the-fold).

**Backend (out of this client slice, flag as blocker):**
- `/applicants/units?amiTier=` filter clause.
- Per-property MSA mapping (so the calculator knows which AMI table to use).

---

## Demo cold-open framing

> "Their site lets unqualified leads waste 20 minutes filling out an application and pay a $40 screening fee before anyone tells them they're over-income. Ours qualifies in 30 seconds — anonymous, on the landing page, before we ask for anything but household size and income. Watch."
>
> → live-type household size + income → tier badge animates in → "you qualify for 50% AMI units" → unit list filters in real-time to 3 units (down from 18) → click apply → wizard pre-fills the tier, never re-asks → checkout → done.

Anchors the entire gpmglv positioning ("affordable-first, eligibility-first, mobile-first") to one continuous demo gesture.

---

## Compliance-mode toggle (v2, out of scope)

Not every Frank-Pilot operator runs LIHTC. A market-rate operator doesn't have AMI caps — they have credit/income-ratio caps (e.g. "income ≥ 2.5× rent"). The calculator should accept a `mode: 'lihtc' | 'market-rate' | 'mixed'` prop driven by the property's compliance profile. v1 ships LIHTC-only (matches the gpmglv competitive narrative); v2 generalizes.

---

## Open questions

1. **Which MSA do we ship first?** Las Vegas–Henderson (gpmglv parity) vs Portland (KAA-relevant) vs both. Recommend LV first — tightest demo fit.
2. **HUD table refresh cadence.** AMI tables update annually (~April). Static constant + yearly PR, or fetch from HUD API? Recommend static — simpler, no runtime dependency, change-log via PR is auditable.
3. **Rent-cap surface.** Tier qualification is income-based, but LIHTC also caps *rent*. Do we show "your monthly rent will be ≤ $X" on the unit cards? Probably yes — strengthens the eligibility narrative. v1 nice-to-have.
4. **Anonymous landing widget — do we write *anything* to the server?** Recommend no. Pure client-side. We can add a "snapshot" event later if we want lead-capture metrics, but the privacy story ("we don't store your income unless you apply") is a feature.
5. **Mobile / EN-ES.** Both must work — gpmglv has neither.

---

## Out of scope (v1)

- Section 8 / voucher integration (Plan B, post-demo).
- Co-applicant income aggregation (the calculator assumes a single household income figure).
- Credit-check bundling (separate slice; doesn't gate eligibility).
- Operator-side dashboard showing pre-qualifier funnel metrics (instrument later).

---

## Dependencies

- **Frozen contract 1** — step order — preserved by Option B, broken by Option A.
- **Frozen contract 2** — payment slice (`adults`, `paymentRef`, `paymentTotal`) — untouched either way.
- **Backend `/applicants/units?amiTier=`** filter — Option B requires this to deliver the "filtered unit list" demo moment. Without it, the calculator works but `StepPick` shows the full list with badges only. Acceptable degraded mode.
- **Tape events** — add `tape/qualify-ami` event for funnel instrumentation. Optional, additive to existing tape contract.

---

## Decision needed

1. Approve Option B (inline) over Option A (discrete step)? **[Y/N]**
2. Ship LV-only AMI table for v1? **[Y/N]**
3. Slot before or after the upcoming demo? **[before / after]** — before is preferred (it *is* the demo); after is safer (no scope creep on a known-good flag-flip path).
