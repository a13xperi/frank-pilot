# GPMGLV Gap Backlog — Competitive Build Tracker

_Active backlog. Source: [`gpmglv-audit.md`](gpmglv-audit.md) + [`gpmglv-bp-03b-positioning.md`](gpmglv-bp-03b-positioning.md)._
_Last updated: 2026-05-22 (wedge #8, #9, #15, #13)._

Every row is a wedge — a feature Frank-Pilot can ship where the evidence-based audit shows GPMGLV (and the "custom Next.js marketing site" tier of affordable-housing operator) has no answer. Pull tickets through this table to keep work grounded in actual competitor weakness, not opinions.

## Recently shipped (as of 2026-05-22 @ `b376800`)

| Wedge | Title | Shipped via | Demo surface |
|---|---|---|---|
| #2 | W0 AMI prefill (Welcome → Apply → Review) | PR #94 | `StepIntent`, `StepReview` |
| #5 | Position-aware waitlist — position display surfaced + waitlist-join branch activated | PR #104 + wedge #5 branch | `StepConfirm` → `/waitlist/position/:slug` CTA (activated 2026-05-22 via wizard zero-units → waitlist branch) |
| #6 | i18n EN/ES parity + CI guard | PR #91 | All apply steps |
| #7 | Mobile-first apply UX | PR #79 + #92 | Sticky CTA behind `MOBILE_APPLY_ENABLED` |
| #14 | Sitemap + robots served as static assets | PR #95 | `vercel.json` negative-lookahead rewrite |
| #8 | Live unit availability + filter | PR #105 + PR #119 | `PropertyList.tsx` → live `GET /api/properties` with `amiTier` / `bedroom` / `availability` params; GET listing is **public** so anonymous gpmglv-demo visitors see live data (create/update/delete remain auth-gated); deterministic GPMG fallback on error |
| #9 | Honest pricing / AMI disclosure on listings | inline (no separate PR) | `PropertyList.tsx` tile rent buckets (`formatRentBucket()`) + AMI tier chip (`t('amiTier.label')`) + `UnitCard.tsx` unit detail |
| #15 | Cookie banner / GDPR posture + analytics gate | inline (no separate PR) + feat/wedge-15-analytics-consent | `state/consent.ts` (localStorage `fp.consent.v1`, useConsent hook) + `components/CookieBanner.tsx` (bottom-fixed, Esc→rejectAll, i18n `legal.*`) + `lib/analytics.ts` (consent-gated vendor init, `VITE_ANALYTICS_VENDOR` flag) |

The ranked table below reflects these shipped statuses inline.

## How to read this

- **Status** — `shipped` / `in-flight` / `half-built` / `scaffold` / `none`.
- **Build cost** — `S` (≤1 day), `M` (≤1 week), `L` (>1 week, multi-PR).
- **Demo punch** — 1 (table-stakes background) to 5 (single-frame competitive kill).
- **Leverage** — `demo punch / build cost` rough score, sorted desc. Ties broken by closeness-to-ship.

## Ranked backlog

| # | Wedge | gpmglv state (evidence) | Frank-Pilot anchor | Status | Cost | Punch | Lev |
|---|---|---|---|---|---|---|---|
| 1 | **Real online application** | Every "Apply now" = `href="#contact"` (audit §Apply Flow) | `client-tenant/src/pages/Apply.tsx` wizard | half-built — flag-gated | S | 5 | ★★★★★ |
| 2 | **AMI pre-qualifier (W0)** | "Income-qualified" mentioned, zero AMI tables disclosed (audit §HUD) | `client-tenant/src/lib/ami.ts` + `components/AmiCalculator.tsx` | shipped 2026-05-22 (PR #94) | S–M | 5 | ★★★★★ |
| 3 | **"Apply button does nothing" demo flip** | property page CTA = `#contact` anchor scroll-jump (audit §Per-Page Dumps) | demo script + landing page mount | none (asset, not feature) | S | 5 | ★★★★★ |
| 4 | **Unit-claim FTU / "carrot" UX** | No unit-level state anywhere on gpmglv | unit-claim slice (PR #5 merged 2026-05-14, commit 58c1036) | shipped, low visibility | S (amplify) | 4 | ★★★★ |
| 5 | **Position-aware waitlist** | Submit-and-wait black hole; no position field (audit §Waitlist) | Lane E waitlist banner | shipped 2026-05-22 (PR #104) — position display surfaced via `StepConfirm` CTA (activated 2026-05-22 via wizard zero-units → waitlist branch) | M | 4 | ★★★ |
| 6 | **EN-ES from day one** | English-only, no language switcher (audit §Per-Page Dumps) | `src/i18n/{en,es}/` scaffold | shipped 2026-05-22 (PR #91) | M | 3 | ★★★ |
| 7 | **Mobile-first apply UX** | gpmglv site is responsive but apply = #contact = no flow to optimize | `MOBILE_APPLY_ENABLED` flag | shipped 2026-05-22 (PR #79 + #92) | M–L | 3 | ★★ |
| 8 | **Live unit availability + filter** | 17 property cards, zero rent, zero availability dates (audit §Property Listing) | `client-tenant/src/pages/discover/PropertyList.tsx` | shipped 2026-05-22 — live `/api/properties` wire (PR #105) + GET listing made public so anonymous /discover visitors get live data (this PR); create/update/delete remain auth-gated; deterministic 17-fixture fallback on error | M | 3 | ★★ |
| 9 | **Honest pricing / AMI disclosure on listings** | Zero rent figures public (audit §Property Listing) | `discover/PropertyList.tsx` + `UnitCard.tsx` | shipped 2026-05-22 | S | 2 | ★★ |
| 10 | **Real applicant accounts (auth)** | No login on tenant side (audit §Tenant Login) | wizard + magic-link infra | shipped (foundational) | n/a | 2 | ★★ |
| 11 | **Eligibility-aware lead routing** | Generic "Community + Message" form, no structured signal (audit §Per-Page Dumps `/contact-us`) | W0 output → property filter | folds into #2 | n/a | n/a | — |
| 12 | **Resident portal: rent pay / docs / lease** | gpmglv `/portal` = maintenance + message + lookup only (audit §Tenant Login) | NEW | none (stage 2, post-move-in) | L | 2 | ★ |
| 13 | **Anti-spam (Turnstile / rate-limit)** | Waitlist + contact forms have no visible captcha (audit §Per-Page Dumps) | server-side rate limit + Turnstile/hCaptcha | shipped 2026-05-22 — `verifyTurnstile()` + rate-limit wired on `POST /properties/:slug/waitlist-join` and `POST /tenant/applications/:id/messages` | S–M | 1 | ★ |
| 14 | **SEO / sitemap / JSON-LD** | `robots.txt` 404, `sitemap.xml` 404 (audit §Robots/Sitemap) | infra | partial — sitemap+robots static-serve fixed 2026-05-22 (PR #95) | S | 1 | ★ |
| 15 | **Cookie banner / GDPR posture** | No `Set-Cookie` observed, thin privacy policy (audit §Cookies) | NEW | shipped 2026-05-22; analytics gate shipped feat/wedge-15-analytics-consent | S | 1 | ★ |

## Top-5 detail

### #1 — Real online application
- **What ships:** the wizard already exists end-to-end behind `VITE_PAYMENT_WIZARD_ENABLED`. With W0 wired, the flag-on path becomes the demo: register → verify → intent + AMI tier → checklist → pick → claim → review → household → payment → confirm.
- **Block:** payment step is a fake-Stripe stub. Fine for demo; **not** fine for first paying operator. Real-Stripe slice is a follow-up.
- **First action:** finish W0 wiring (#2), then flip the flag in prod for the demo subdomain only.

### #2 — AMI pre-qualifier (W0)
- **Shipped (Phase 1):** `src/lib/ami.ts` (HUD-LV table + `qualifyAmiTier()`), `components/AmiCalculator.tsx` (standalone + embedded modes), 22 tests.
- **Outstanding (Phase 2 — three edits):**
  1. `pages/apply/ApplyContext.tsx` — add `grossAnnualIncome`, `qualifyingAmiTier`, `qualifyingAmiCalculatedAt`, `qualifyingHouseholdSize` to `ApplyState` + propagate through `wizardTestUtils.tsx`.
  2. `pages/apply/steps/StepIntent.tsx` — embed `<AmiCalculator embeddedHouseholdSize={intentHouseholdSize} hideCta onResult={…} />`. Capture income via existing pattern.
  3. `pages/apply/steps/StepReview.tsx:22-35` — replace hardcoded `'50–60% AMI'` with `useApply().qualifyingAmiTier`. Update `__tests__/StepReview.test.tsx:36`.
- **Plus landing-page mount:** `<AmiCalculator mode="standalone" />` above-the-fold on the welcome route — anonymous, optional, the demo cold-open.
- **Backend dependency:** `/applicants/units?amiTier=` filter (server lane). Without it, list still works, just doesn't pre-filter.
- See [`docs/bp-03b-w0-ami-pre-qualifier.md`](../bp-03b-w0-ami-pre-qualifier.md).

### #3 — "Apply button does nothing" demo flip
- **Not a feature, an asset.** The audit gives us the literal proof: every gpmglv property page CTA is `href="#contact"`. Frame it side-by-side with our flag-on wizard.
- **Build:** 60s screencap + matching 60s of our flow. Slide template + voice-over script.
- **Reuse:** sales deck, prospect calls, landing-page hero. Ship once, use forever.

### #4 — Unit-claim FTU / "carrot" UX
- **Already merged** (PR #5, 58c1036). Currently underplayed in copy and UI.
- **Amplify:**
  - Surface "your claim holds for 24h" countdown in `ClaimedUnitHeader.tsx`.
  - Email reminder ("your claimed unit is still available — finish your application") via Lane E tape events.
  - Confetti / celebration moment when the claim succeeds (small, but the "plant-a-flag" thesis lives or dies on this beat).
- Tracked in memory: `[FTU = applicant→tenant via unit-claim](../memory/project_ftu_unit_claim_carrot.md)`.

### #5 — Position-aware waitlist
- **Lane E** shipped the waitlist banner. Missing pieces:
  - Position number (`#142 of 287 for Meacham 1BR`) — requires server ordering by `created_at` per `(property_id, bedroom_count)`.
  - Periodic status email — fires when position changes by ≥10 or when a unit comes available in the bedroom tier.
- **Beat:** the demo says "see how their waitlist works? You submit and disappear. Here's ours." Then show the position counter ticking.

## Explicitly NOT priorities

Carry-over from positioning brief — these gaps are real but not the wedge:
- Resident portal post-move-in features (rent pay, lease, docs) — stage 2, not the apply→tenant ramp.
- Cookie banner / GDPR — shipped 2026-05-22 (#15); was table stakes, not a positioning lever.
- SEO infrastructure — easy win but not a product differentiator. Backlog as #14.

## Update protocol

- When a row ships, change status + add a memory link. Don't delete — the comparison stays useful for sales/positioning.
- New audit findings (re-crawl, new competitor) → new rows. Re-rank top-5 only; backlog can stay in audit order.
- Build cost / demo punch are *current-state* estimates. Bump when implementation reveals surprises.

## See also

- [`gpmglv-audit.md`](gpmglv-audit.md) — full evidence base (26 pages crawled).
- [`gpmglv-bp-03b-positioning.md`](gpmglv-bp-03b-positioning.md) — curated narrative.
- [`../bp-03b-w0-ami-pre-qualifier.md`](../bp-03b-w0-ami-pre-qualifier.md) — W0 design.
