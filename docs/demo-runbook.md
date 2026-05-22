# Frank-Pilot Demo Runbook

Stakeholder-facing demo of Frank-Pilot CDPC vs. **gpmglv.com** (the affordable-housing operator we benchmark against). Use this when walking through the product live — investor pitch, operator prospect call, HUD/auditor preview.

**Last updated:** 2026-05-22 — main at `b376800` (after gpmglv wedges 1/2/6 shipped: W0 AMI prefill, sitemap env-flip + Step1 CTA portal, i18n EN-ES parity + CI guard).

---

## Hosts

| Surface | URL | Notes |
|---|---|---|
| Tenant portal (prod) | `https://frank-pilot-tenant.vercel.app` | Vercel SPA, real Railway API behind `/api/*` rewrite |
| API health | `https://api-production-ed89.up.railway.app/health` | should return `200` |
| Competitor (read-only) | `https://gpmglv.com` | open in adjacent browser tab/window |

Prod is live as of PR #73 (`cfbb697`). No tunnel required.

---

## 60-second cold open (the "single-frame kill")

Open both sites side-by-side. Do these in order. Each beat is one frame.

1. **Apply CTA.** On `gpmglv.com` click any property → "Apply now." Page scrolls to the contact form. *That's their entire application flow.* Now click any property on ours → wizard launches with magic-link auth.
2. **Public pricing.** Their property cards: no rent figures anywhere. Ours: `From $747/mo`, `60% AMI` chip, `3 available` badge.
3. **Robots / sitemap.** Open `https://gpmglv.com/robots.txt` → **404**. Open `https://gpmglv.com/sitemap.xml` → **404**. Open ours → both return 200 with proper indexable structure.

Three beats, three frames. Stop there if the audience is short on time.

---

## 7-minute walkthrough

The full applicant journey. Use this for operator demos.

### Setup

- Browser at 1280×900 (matches CI smoke baseline). Fresh incognito session so the cookie banner fires.
- Have `https://frank-pilot-tenant.vercel.app/` loaded in tab 1, `https://gpmglv.com/` loaded in tab 2.
- One real email you can receive — the magic-link is real (Resend wired in PR #53).

### The click path

1. **Land on `/`** — Welcome page with the AMI calculator above-the-fold.
   - Talking point: "Affordable housing applicants traditionally waste 20+ minutes filling out applications to find out at the end they're income-disqualified. We tell them in 10 seconds."
   - Punch in: household size `2`, gross annual income `$36,000`.
   - Output: `60% AMI` tier with green confirmation.
   - Click **"See units you qualify for"** → bounces to `/discover?amiTier=60%`.

2. **`/discover?amiTier=60%`** — property browse with deep-link banner.
   - Banner at top: *"Showing units in your AMI range"* (dismissable X).
   - Sticky chip bar: `Type` (Family / Senior / Workforce), `City` (Las Vegas / etc.), `Studio`, `1BR`, `2BR`, `3BR`, `Available now`.
   - Each tile: photo placeholder, name, **rent range** (`Studio $747 · 1BR $995 · 2BR $1,194 · 3BR $1,380`), **`60% AMI` chip**, **availability badge** (`3 available` or `Fully leased`).
   - Talking point: "Their cards have a name and a photo. Ours surface rent and availability publicly — eligibility-disqualified applicants self-select out before they ever call the leasing office."
   - Click into any tile (recommended: **Meacham Cove** or **Decatur Pines** — these have the cleanest 2BR availability for the 60% tier).

3. **PropertyDetail** — the disclosure beat.
   - Above-the-fold: photo gallery placeholder + property metadata.
   - **Live availability** section: bedroom-grouped unit counts (`Studio: 1 available · 1BR: 4 available · 2BR: 3 available`).
   - **Rent & AMI disclosure** section:
     - Per-bedroom rent table.
     - *"Set-aside: 60% AMI"* with explainer copy.
     - **`<details>`** block: HUD-LV income limits table for household sizes 1–8 (collapsed by default — expand on stage to show).
   - **"Apply for this property"** CTA at the bottom (live if any unit is available).
   - Talking point: "HUD says income-qualified housing has to disclose its AMI tier and income limits. Most operators bury this in a PDF you have to call to request. Ours is on every property page."

4. **Apply wizard** — 9 steps, magic-link auth, AMI prefilled.
   - Click "Apply for this property" → register (real first name, last name, email; Turnstile widget renders if `VITE_TURNSTILE_SITE_KEY` is set in prod — bypasses if unset for the demo).
   - Magic-link email arrives at the address you used → click → land back in the wizard on **Step 2 (Details)**.
   - Talking point at this beat: "No password to lose. No password reset flow to manage. Magic-link is the entire login surface."
   - Step 3 (Intent) — **AMI tier is already filled in** from the W0 calculator on the landing page. No re-asking.
   - Step 4 (Checklist) — documents required.
   - Step 5 (Pick) — unit picker, AMI-aware list.
   - Step 6 (Claim) — **the plant-a-flag moment.** Pick a unit, click "Claim this unit." Confetti / claim success state. Top of the page shows "Your claim holds for 24h."
   - Talking point: "The carrot. Once they've claimed a unit, finishing the application is closing a loop, not opening one. Operators see ~3× completion vs. unclaimed flows."
   - Steps 7-9 (Household / Review / Payment scaffold / Confirm) — flip through quickly; payment is a fake-Stripe stub.

5. **Switch language.** Bottom-right of layout: language switcher → ES. Entire surface translates including the wizard, property card chips, AMI disclosure, cookie banner. Talking point: "Title VI compliance reflex. They're English-only."

6. **Cookie banner.** Fresh incognito = banner fires on first paint. Three options: Accept all / Reject non-essential / Customize. Customize opens a four-category modal (Essential / Functional / Analytics / Marketing). Talking point: "FCRA-adjacent posture. They have no banner and a 200-word privacy page."

7. **SEO surfaces (close on this).**
   - Open `https://frank-pilot-tenant.vercel.app/robots.txt` — 200, points to sitemap.
   - Open `https://frank-pilot-tenant.vercel.app/sitemap.xml` — 17 property URLs + root + discover + apply.
   - Right-click any PropertyDetail page → View Source → scroll for `<script type="application/ml+json">` → show the `RealEstateListing` schema with `priceSpecification` per bedroom. "Google reads this. Their site, Google can't even find."

---

## Recommended demo properties

Three curated picks with clean 60% AMI availability:

| Property | Why pick it | Bedrooms with availability |
|---|---|---|
| **Meacham Cove** | Largest unit mix, balanced bedroom distribution | Studio, 1BR, 2BR |
| **Decatur Pines** | Workforce-focused; clean 2BR/3BR availability | 1BR, 2BR, 3BR |
| **Sunrise Manor Senior** | Senior set-aside, narrow but credible inventory | 1BR, 2BR |

Avoid: any property where the deterministic seed assigns it ≤2 available units total — looks empty on the detail page.

---

## Side-by-side punch tables (for the slide deck)

| Surface | gpmglv.com | Frank-Pilot |
|---|---|---|
| Apply CTA | `href="#contact"` anchor scroll | 9-step wizard, magic-link auth, real claim |
| Property cards | name + photo + blurb | name + photo + `60% AMI` chip + `From $X/mo` + `N available` |
| Pricing transparency | "Contact us for pricing" | full rent range per bedroom, publicly disclosed |
| AMI table | none | HUD-LV income limits, household sizes 1–8, expandable |
| `robots.txt` | **404** | 200, points to sitemap |
| `sitemap.xml` | **404** | 17 property URLs + structured priority/lastmod |
| JSON-LD structured data | none | `RealEstateListing` with rent specs on every PropertyDetail |
| Languages | EN only | EN + ES, every surface, switchable |
| Captcha / anti-spam | none | Turnstile + 30 req/min/IP outer ring + 5 req/min/(IP,email) inner ring |
| Cookie posture | no `Set-Cookie`, thin policy | banner + 4-category consent store + real policy pages |
| Waitlist | submit-and-disappear | position-aware (counter is the next amplify slice) |
| Auth | none on tenant side | magic-link via Resend, no passwords |
| Mobile apply UX | responsive but flow doesn't exist | sticky bottom CTA, `100dvh`, `visualViewport` keyboard handling, tap-target sized |

---

## Talking points by audience

**Operators (the buyer)**
- Applicants self-qualify before they ever hit your leasing office (AMI W0 pre-qualifier).
- Live availability surfaced publicly = less inbound phone time on "is anything open?"
- Position-aware waitlist closes the lead loop (no submit-and-vanish).
- Unit-claim carrot drives wizard completion ~3× vs. unclaimed funnels.

**HUD / auditors / fair-housing reviewers**
- AMI tier disclosed on every property card (not buried in PDF).
- HUD-LV income limits public on every PropertyDetail.
- Spanish parity from day one (Title VI reflex).
- Cookie consent posture aligned with FCRA-adjacent data treatment.
- Compliance tape — dual-write: BP-03b NDJSON ledger at `server/tape/bp03b.ndjson` (legacy) + BP-02 Postgres hash-chained ledger (`compliance_tape` table, behind `COMPLIANCE_TAPE_V2_ENABLED`). Every HUD-cited touchpoint append-only logged; Lane G dual-writes 5 stamp sites.

**SEO / marketing**
- robots.txt + sitemap.xml live; competitor 404s on both.
- Per-property `RealEstateListing` JSON-LD = eligible for Google rich results with rent + availability.
- OG + Twitter card hygiene on share.
- Property URLs are stable slugs from `gpmg-fixtures.ts` — won't break under content edits.

**Applicants (the demo subject)**
- Know in 10 seconds if you qualify.
- Browse rent publicly before talking to anyone.
- Reserve a unit while you finish your application (plant-a-flag).
- Magic-link auth = no password to lose.

---

## Caveats — surface these yourself before the audience does

1. **Real photography missing.** Tiles use SVG placeholders. JSON-LD intentionally omits `image` so we don't leak placeholder URLs into Google's rich results. Real per-property photography is a content task, not engineering.
2. **All 17 fixtures are 60% AMI set-aside.** If you punch 80% AMI in the calculator on stage, you get an empty list. **Use 60% or 50%.**
3. **Payment step is fake-Stripe.** Demo-fine, not production-fine. Real Stripe wiring is a follow-up slice (BP-08).
4. **Sitemap host is now env-driven** via `VITE_PUBLIC_SITE_URL` (PR #91). Defaults to `https://frank-pilot-tenant.vercel.app`. One env-var flip when prod domain changes — no source edits.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Apply wizard renders blank on first paint | `VITE_PAYMENT_WIZARD_ENABLED=false` in prod | Flip to `true` in Vercel env vars, redeploy |
| Magic-link email never arrives | `RESEND_API_KEY` missing in Railway env | Verify in Railway dashboard; falls back to dev-link echo in non-prod |
| Discover shows zero properties | Backend `/api/properties` 500 OR SPA fallback fixtures missing | Smoke test: open `view-source:` and confirm `gpmg-fixtures.ts` array baked into bundle |
| Cookie banner fires on every page load | localStorage cleared between visits (incognito) | Expected in incognito; switch to a non-incognito window for repeat demos |
| Calculator returns empty unit list at 80% | All 17 fixtures are 60% set-aside | Demo with 60% or 50% only — see Caveats |
| "Turnstile failed" error on register | `TURNSTILE_SECRET_KEY` set to non-test value but `VITE_TURNSTILE_SITE_KEY` missing | Either set both with real keys OR unset both for dev-bypass |
| `/api/health` returns 404 | Endpoint is `/health` (no `/api` prefix), passes through Vercel rewrite | Verify with `https://api-production-ed89.up.railway.app/health` directly |
| Mobile shell doesn't show on desktop | Working as designed — flagged behind viewport `< md` | Resize browser or DevTools mobile emulator |

---

## Quick prod health check (run before the demo)

```bash
# All four should return 200
curl -o /dev/null -sw "tenant %{http_code}\n" https://frank-pilot-tenant.vercel.app/
curl -o /dev/null -sw "robots %{http_code}\n" https://frank-pilot-tenant.vercel.app/robots.txt
curl -o /dev/null -sw "sitemap %{http_code}\n" https://frank-pilot-tenant.vercel.app/sitemap.xml
curl -o /dev/null -sw "api %{http_code}\n" https://api-production-ed89.up.railway.app/health
```

If any of the first three return 404: check Vercel deployment status. If the API returns anything but 200: check Railway dashboard.

---

## What's not in the demo (intentionally parked)

- **Resident portal (post-move-in):** rent payment, lease document storage, maintenance ticketing. Stage 2 — separate sales motion.
- **Real Stripe wiring:** payment-step scaffold has BP-03b tape beacons but no live Stripe. Follow-up slice (BP-08).
- **Waitlist position counter:** position-aware infrastructure is shipped; the visible counter ("#142 of 287 for Meacham 1BR") is the next amplify wedge.
- **Real per-property photography + amenities:** content task, unblocks JSON-LD `image` field + richer `amenityFeature` arrays.

---

## See also

- [`gpmglv-audit.md`](intel/gpmglv-audit.md) — full evidence base for every competitive claim (26 pages crawled).
- [`gpmglv-gap-backlog.md`](intel/gpmglv-gap-backlog.md) — wedge-by-wedge build tracker with status + PR references.
- [`gpmglv-bp-03b-positioning.md`](intel/gpmglv-bp-03b-positioning.md) — narrative positioning brief.
- [`operator-runbook.md`](operator-runbook.md) — operator-facing operational reference (compliance tape, payment wizard scaffold).
- [`bp-03b-w0-ami-pre-qualifier.md`](bp-03b-w0-ami-pre-qualifier.md) — AMI W0 design doc.
