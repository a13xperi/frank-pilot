# gpmglv.com — Tenant Flow Audit (Evidence-Based)

_Crawl performed: 2026-05-21. 26 pages fetched via WebFetch + 3 `curl -sI` header probes. Tool: WebFetch + Bash._

## Executive Summary

GPMGLV is the website of **Global Property Management — Las Vegas Affordable Housing**, an affordable-housing operator managing 17 LIHTC communities (~1,000 units) in the Las Vegas / North Las Vegas / Henderson area. The site is a marketing-and-contact site, NOT a transactional tenant platform. Here is the apples-to-apples comparison to a best-in-class digital tenant flow.

- **Digital-first apply flow: ABSENT.** Every "Apply now" CTA on every property page is `href="#contact"` — an in-page anchor to the same generic 5-field contact form (Name, Phone, Email, Community dropdown, Message). evidence: per-property page extraction shows "Apply now → #contact" on Aldene Kline, Dr. Paul Meacham, Donna Louise, Yale Keyes, Owens, Smith Williams, Senator Harry Reid, Senator Richard Bryan, Ethel Mae Robinson, Ethel Mae Fletcher, Louise Shell, Sarann Knight, Juan Garcia, Dr. Luther Mack, David J. Hoggard, Donna Louise 2. No `/apply` route exists (returns 404).
- **SSO / account creation: ABSENT.** There is no applicant or tenant account anywhere. The "Resident portal" (`/portal`) has zero login form — it is a public-facing dispatch page that links only to maintenance request, contact management, and reference-number lookup. evidence: `/portal` returns "No forms, no login, no sign-up."
- **ID + income upload: ABSENT.** No file-upload `<input type="file">` was observed on any fetched page. No mention of income docs, ID verification, paystubs, W-2, tax returns anywhere in the crawl.
- **Automated screening: NOT OBSERVABLE.** No mention of Experian, TransUnion, RealPage, AppFolio screening, background checks, or any screening vendor. Privacy policy is silent on third-party processors.
- **Holding deposit via card: ABSENT.** No payment widget, no Stripe/Square/Plaid asset, no "deposit" copy on any fetched page.
- **Real-time application status: ABSENT.** Closest thing is `/portal/lookup` — a reference-number lookup for **maintenance requests**, not applications. evidence: lookup page H1 = "Look up a request" with single `Reference` field, example format "REF-20260420-ABC123".
- **Mobile-first: PARTIAL.** Site is Next.js with `<meta name="viewport" content="width=device-width, initial-scale=1"/>`, modern responsive scaffolding. But no progressive-web-app affordances, no app-store links.
- **EN / ES bilingual: NOT OBSERVABLE.** No language switcher, no `lang="es"` route, no Spanish anywhere in fetched HTML. Significant for a Las Vegas affordable-housing operator — likely a real gap.
- **Accessibility commitment: WEAK.** Pages mention "ADA accommodations" and "Reasonable accommodations available upon request" but no WCAG statement, no AODA-style accessibility page (none fetched, none linked).
- **Waitlist UX: PRESENT but rudimentary.** `/join-waitlist` is the *only* real prospective-resident flow. Single form with `?property=<slug>` query-string deeplinks from each property page. Fields are loose (no required attributes observed). No position display, no estimated wait time, no eligibility pre-qualification.

**Backend identification.** Self-built on **Next.js (server-rendered, prerendered)** behind **nginx**, hosted on a **Plesk Linux** stack. evidence: response headers — `server: nginx`, `x-powered-by: Next.js`, second `x-powered-by: PleskLin`, plus `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`, and `_next/static/chunks/*.js` bundles in the rendered HTML. There is **no AppFolio, RentCafe, Yardi, Buildium, or PropertyWare** integration visible — every property page lacks third-party iframes, the portal links stay internal, and the privacy policy names no processors. Forms post to the same Next.js app (form `action` attributes were not exposed in the rendered HTML — likely React form handlers wired to Next.js Route Handlers/API routes).

## Apply / Rental Application Flow

There is **no application flow** in the conventional online sense. The reconstruction:

**Step 1 — Browse properties.** `/properties` lists 17 communities with name, address, phone, and a "View community →" link. Two filter buttons (Senior Living, Family Housing). No price, no real-time availability, no unit-level inventory.

**Step 2 — Open a property page.** e.g., `/homes/aldene-kline-barlow-senior-community`. The page shows the property's photo gallery (~4 images), amenity bullets, eligibility blurb ("Income-qualified" / "Income and program restrictions may apply"), and **three CTAs**:
- `Call (702) 920-6550` → `tel:7029206550`
- `Apply now` → `#contact` (in-page anchor) — evidence: extracted from Aldene Kline page
- `Join waitlist` → `/join-waitlist?property=aldene-kline-barlow-senior-community`

**Step 3a — "Apply now" path.** Scrolls to the same contact form that appears on the homepage, properties index, and every property page:
```
- Name (text, required)
- Phone (text, required)
- Email (text, not required)
- Community (select, required) — dropdown of all 17 properties
- Message (textarea, 500-char limit)
- Submit: "Send Message"
```
This is a **lead-capture form**, not an application. No application questions (household size, income, ID, employer, references, prior addresses, pets-in-detail). No file upload. No fee collection.

**Step 3b — "Join waitlist" path.** `/join-waitlist`. Fields observed (no `required` attributes detected on any field — looks loosely validated):
```
- Full name (text)
- Phone (tel)
- Current address (text)
- Website (text) — unexpected field; likely an unlabeled overflow / honeypot or template residue
- Date needed (date — type not observable)
- Apartment type (select, multiple — Studio / 1BR / 2BR / 3BR)
- Pets (type not observable)
- Property selection (checkbox list of all 16 communities)
- Submit: "Join selected waitlists"
```
A user can join multiple property waitlists with one submission. No income pre-qualification, no AMI calculator, no household-size validation, no estimated wait, no position number, no email/phone verification visible.

**Step 4 — Status / follow-up.** Not observable. No applicant dashboard, no status email mentioned in fetched copy, no portal entry for applicants.

**Conclusion.** The real "application" is offline — applicants must call the property's leasing phone number (each property has its own number) or wait for staff to follow up on a contact/waitlist submission. The website is an inbound-lead funnel, not an apply pipeline.

## Property / Unit Listing

`/properties` H1: "Find Your New Home Today". All 17 communities surfaced as cards with:
- Community name
- Address (city + ZIP)
- Phone number
- "View community →" link to `/homes/<slug>`
- Filter chips: All Communities / Senior Living / Family Housing

**Missing vs. modern PM sites:** no unit-level inventory, no live availability counts, no bedroom-count filter, no rent-band filter, no map, no photo on the index card (per extracted content), no "Apply Now" CTA at the index level (only from inside the property page).

Individual property pages (sampled: 16 of 17 fetched successfully) follow a uniform template. They list **bedroom configurations** (mostly "1 & 2-bedroom senior apartments" or "Studio / 1BR / 2BR / 3BR" for family communities) and amenities but disclose **no rent figures, no current availability count, no unit-level photos, no income limits, no AMI percentages**. The standard disclaimer is "Availability and pricing subject to change."

## Tenant Login / Portal

`/portal` — public dispatch page. H1: "Resident portal". No login form. Body links:
- `/portal/maintenance` — Maintenance request
- `/portal/contact-management` — Contact management
- `/portal/lookup` — Look up a request by reference number

**Notable:** there is **no rent-pay, no document download, no lease access, no resident dashboard**. The site delivers two transactional flows post-move-in: file a maintenance ticket, or message management. evidence: full extraction of `/portal`, `/portal/maintenance`, `/portal/contact-management`, `/portal/lookup` — all four pages contain no auth UI.

### `/portal/maintenance`
Form fields (all visible inputs):
- Community (select, required)
- Apartment/unit number (text, required)
- Issue type (select, required)
- Urgency (select, required)
- Description (textarea, required)
- Name (text, required)
- Phone (tel, optional)
- Email (email, optional)
- Submit: "Submit request"

### `/portal/contact-management`
Form fields:
- Subject (text, required)
- Message (textarea, required)
- Your name (text, required)
- Phone (tel, optional)
- Email (email, optional)
- Submit: "Submit"

### `/portal/lookup`
- Reference (text) — example format quoted: "REF-20260420-ABC123"
- Submit: "Look up"

### `/login` — STAFF portal (not for residents/applicants)
A separate route exists at `/login`. It is a JS-rendered, animated splash page H1 "Global Meridian" with three sections: **Maintenance / Manager / Corporate**. Body copy: `"Property Management Portal" / "Establishing uplink…" / "36.1699°N · 115.1398°W · ALT 620m"`. Sub-paths `/login/maintenance`, `/login/manager`, `/login/corporate` all return 404 — the splash links are JS-mediated. Response headers show `cache-control: private, no-cache, no-store` (distinct from the public pages' `s-maxage=31536000`), confirming this is intended as a non-cached staff entry, not a public tenant entry. **Tenants are not directed here from any user-facing CTA in the crawl.**

## Waitlist

Yes — `/join-waitlist` is the central prospect-capture system. Each property page deeplinks with `?property=<slug>`, meaning the form pre-selects (or is intended to pre-select) the originating property's checkbox. Multi-property submission is supported via the "Join selected waitlists" button.

**Gaps:**
- No position number, no FIFO display, no last-updated timestamp.
- No eligibility pre-qualification (income, household size, age for senior properties).
- No email/phone verification — submission is presumably accepted as-is.
- The `Website` field is anomalous (no plausible reason to ask a waitlist applicant for a website URL; this may be a hidden honeypot or template residue).
- No confirmation flow visible in the static HTML (could be JS-driven post-submit, not observable).

## Tech Fingerprint

Based on response headers (`curl -sI`) and rendered-HTML inspection:

- **Framework**: Next.js (App Router, prerendered) — `x-powered-by: Next.js`, `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`, `vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch`. Bundler likely Turbopack — chunk `_next/static/chunks/turbopack-153-9~uu.s6g6.js` observed in homepage HTML.
- **Reverse proxy**: nginx (`server: nginx`).
- **Server stack**: Plesk Linux — second `x-powered-by: PleskLin` header observed on every page. Plesk is a cPanel-class shared-hosting control panel; consistent with a small operator running the site themselves rather than via a property-management SaaS.
- **CDN / cache**: `cache-control: s-maxage=31536000` on public pages (`/`, `/portal/maintenance`, `/join-waitlist`); `cache-control: private, no-cache, no-store` on `/login` only.
- **Fonts**: Google Fonts (Playfair Display + Outfit) — `<link rel="preload" href="https://fonts.googleapis.com/css2?family=Playfair+Display..."` observed.
- **Analytics / tag managers**: **None observed** in the rendered HTML. No GTM, GA, FB pixel, Hotjar, or Segment script src visible in homepage HTML or any other page extraction.
- **Third-party PM SaaS**: **None observed.** No AppFolio, Yardi, RentCafe, Buildium, PropertyWare, ResMan, or Entrata iframe or script. evidence: zero iframes detected across 16 property pages, the portal subtree, and `/join-waitlist`.

This is a **custom-built site**, plausibly developed for the operator by a small contractor — the chunk filenames (`0x-99-hmhae7i.css`, `0gxlnocisoc~6.js`) suggest minified production builds, the cache headers suggest deliberate Next.js ISR usage.

## Robots / Sitemap

- `https://gpmglv.com/robots.txt` — **HTTP 404**.
- `https://gpmglv.com/sitemap.xml` — **HTTP 404**.
- `https://gpmglv.com/sitemap_index.xml` — **HTTP 404**.

No sitemap/robots discovery surface. SEO discoverability relies entirely on the internal link graph + Next.js Metadata API (`<meta name="description">` and Open Graph tags are present and well-formed).

## Cookies / Headers

From `curl -sI -L` on three representative pages:

| Header | Homepage `/` | `/portal/maintenance` | `/join-waitlist` | `/login` |
|---|---|---|---|---|
| `server` | nginx | nginx | nginx | nginx |
| `x-powered-by` (1st) | Next.js | Next.js | Next.js | Next.js |
| `x-powered-by` (2nd) | PleskLin | PleskLin | PleskLin | PleskLin |
| `x-nextjs-cache` | HIT | HIT | HIT | (absent) |
| `x-nextjs-prerender` | 1 | 1 | 1 | (absent) |
| `cache-control` | s-maxage=31536000 | s-maxage=31536000 | s-maxage=31536000 | private, no-cache, no-store |
| `Set-Cookie` | **none observed** | **none observed** | **none observed** | **none observed** |
| `etag` | `"12wgqkc5m5017qe"` | `"rpwyfw5mr2m5e"` | `"y0yvz43n70wog"` | (absent) |

**Set-Cookie not observed in HEAD responses for any page.** No tracking cookies, no session cookies sent on first byte. This means: (a) no cookie-based auth in the portal, (b) any session/CSRF cookies are issued only on POST submission (not testable without submitting, which is out of scope), (c) cookie banner — none visible in static HTML extractions.

## HUD / Section 8 / Fair Housing Language

The site is positioned around the **LIHTC (Low-Income Housing Tax Credit) program**, not Section 8. Verbatim quotes:

- About Us — Mission: *"To manage properties for corporations that invest in real estate. To monitor property goals on a regular basis to ensure ongoing compliance for the owner, to provide counseling, training, and education for low income renters and homebuyers. To create public/private partnerships to manage, develop and build new affordable housing."*
- About Us — *"low-income housing tax credit programs"* and *"LIHTC, NSP, IRS, and equity investor requirements"* (under "Compliance Excellence")
- About Us — *"deep fair housing knowledge"*
- Properties index — *"quality, affordable housing for seniors and families"* / *"Providing affordable, quality housing for low-income individuals and senior citizens"*
- Property pages (recurring template) — *"Income-qualified"*, *"Income-restricted housing with clear qualification criteria"*, *"Income and program restrictions may apply"*
- Property pages — *"Equal Housing Opportunity. Reasonable accommodations available upon request."*
- Footer (recurring) — *"Equal Housing Opportunity"* logo

**Not found in any fetched HTML:**
- "Section 8" / HCV / Housing Choice Voucher
- Specific AMI percentages (30% / 50% / 60% / 80%)
- Specific income ceilings or rent caps
- Household-size income tables
- HUD program names (NSP is referenced once in About Us "Compliance Excellence" but not explained to applicants)

This is **a meaningful gap for prospective applicants** — they cannot self-assess eligibility before filling out a contact form or joining a waitlist.

## Per-Page Dumps

### https://gpmglv.com/
- **Title**: GPMGLV | Global Property Management — Las Vegas Affordable Housing | GPMGLV
- **H1**: A Place to Call Home
- **Top CTAs**: "View Our Homes" → `/properties`; "Apply for Housing" → `/contact-us` (note: this is the only place "Apply" routes to a different URL — and it still routes to the contact form, not an application); "Call us directly" → `tel:7028738882`; "Learn More About Us" → `/about-us`
- **Forms**: Contact form (Name req / Phone req / Email opt / Community select req / Message textarea 500c / Submit "Send Message")
- **Iframes**: none
- **Notable**: 6 featured property cards + "View All 17 Communities" link. Meta description: *"Vegas' #1 Affordable Housing Provider. Global Property Management manages 17 senior and family communities across Las Vegas, North Las Vegas, and Henderson."*

### https://gpmglv.com/about-us
- **Title**: About Us | GPMGLV
- **H1**: About Us
- **Top CTAs**: phone link only
- **Forms**: none
- **Iframes**: none
- **Notable**: Founded 2002 by CDPCN; 20+ years; 1,000+ units; 6 stated principles (Compliance Excellence, Resident-Centered support, Diverse Expertise, Development Partners, Regulatory Mastery, Community Partnerships); explicit mentions of LIHTC, NSP, IRS, fair housing.

### https://gpmglv.com/properties
- **Title**: Our Communities | GPMGLV
- **H1**: Find Your New Home Today
- **Top CTAs**: per-card "View community →"; "Join Waitlist"
- **Forms**: filter chips (All / Senior Living / Family Housing) — no full form
- **Iframes**: none
- **Notable**: All 17 communities listed in a card grid with name, address, phone.

### https://gpmglv.com/contact-us
- **Title**: Contact Us | GPMGLV
- **H1**: Get in Touch
- **Top CTAs**: phone link; form submit
- **Forms**: Same 5-field contact form (Name req, Phone req, Email opt, Community select req, Message 500c, "Send Message")
- **Iframes**: none
- **Notable**: Address 2009 Alta Drive, Las Vegas, NV 89106. Hours Mon–Fri 9–5.

### https://gpmglv.com/join-waitlist
- **Title**: Join Our Waitlist | GPMGLV
- **H1**: Join Our Waitlist
- **Forms**: Full name / Phone / Current address / Website / Date needed / Apartment type select-multiple (Studio, 1BR, 2BR, 3BR) / Pets / Property checkboxes (16 communities) / Submit "Join selected waitlists"
- **Iframes**: none
- **Notable**: No required-field attributes detected; `Website` field is anomalous.

### https://gpmglv.com/portal
- **Title**: Resident portal | GPMGLV
- **H1**: Resident portal
- **Top CTAs**: `/portal/maintenance`, `/portal/contact-management`, `/portal/lookup`
- **Forms**: none
- **Iframes**: none
- **Notable**: No login, no auth, no rent-pay.

### https://gpmglv.com/portal/maintenance
- **Title**: Resident portal | GPMGLV
- **H1**: Maintenance request
- **Forms**: Community select req / Apt# text req / Issue type select req / Urgency select req / Description textarea req / Name text req / Phone tel opt / Email email opt / Submit "Submit request"
- **Iframes**: none

### https://gpmglv.com/portal/contact-management
- **Title**: Resident portal | GPMGLV
- **H1**: Contact management
- **Forms**: Subject text req / Message textarea req / Your name text req / Phone tel opt / Email email opt / Submit "Submit"
- **Iframes**: none

### https://gpmglv.com/portal/lookup
- **Title**: Resident portal | GPMGLV
- **H1**: Look up a request
- **Forms**: Reference text / Submit "Look up"
- **Notable**: Reference format quoted as "REF-20260420-ABC123"

### https://gpmglv.com/resources
- **Title**: (homepage meta — appears to reuse homepage title) GPMGLV | Global Property Management — Las Vegas Affordable Housing | GPMGLV
- **H1**: Community Resources
- **Notable**: External link directory to NV Energy, Southwest Gas, LVVWD, CenturyLink, Cox, DirecTV, Clark County, City of LV / NLV / Henderson, CCSD, UNLV, CSN, NSC, NV DMV. No HUD/Section 8 link in this directory.

### https://gpmglv.com/privacy-policy
- **H1**: Privacy Policy
- **Notable**: Generic boilerplate. Data collected: name, phone, email, mailing address. No cookies/retention/opt-out/third-party processors named.

### https://gpmglv.com/terms-and-conditions
- **H1**: Terms & Conditions
- **Notable**: No operational text about applications, fees, screening, EN/ES, or accessibility commitments — generic terms only.

### https://gpmglv.com/login
- **Title**: GPMGLV | Global Property Management
- **H1**: Global Meridian
- **Body verbatim**: *"Property Management Portal" / "Establishing uplink…" / "36.1699°N · 115.1398°W · ALT 620m"*
- **Sections**: Maintenance, Manager, Corporate
- **Notable**: Staff-side splash, JS-rendered, no static form fields, sub-paths 404, distinct cache headers (`private, no-cache, no-store`). Not linked from any tenant-facing nav.

### Property pages (16 fetched successfully)
All follow the same template: name H1, ~4-photo gallery, amenity bullets, eligibility blurb ("Income-qualified" / "Income and program restrictions may apply"), embedded contact form (same 5 fields as homepage), embedded waitlist form. CTAs:
- `Call <property number>` → `tel:<number>`
- `Apply now` → `#contact` (in-page anchor) — **every property page**
- `Join waitlist` → `/join-waitlist?property=<slug>`
- Previous/Next community navigation

Bedroom counts: senior properties consistently "One & two-bedroom"; family properties (Hoggard, Donna Louise, Donna Louise 2, Juan Garcia, Sarann Knight, Dr. Luther Mack) consistently "Studio / 1BR / 2BR / 3BR". **No rent prices anywhere.** No square footage. No move-in date availability. No unit-level inventory.

Per-property addresses + phones in the table on the `/properties` per-page-dump above.

## Gaps & Opportunities

If Frank-Pilot is building a tenant portal for affordable-housing operators like GPMGLV, the gaps here translate directly into wedge product features:

1. **Replace the "Apply now → #contact" black hole with a real online application.** Every property page CTA on GPMGLV is a UX dead-end. Frank-Pilot can offer a structured application: household composition, income, employer, prior addresses, references, ID upload, income-doc upload — all routing to a server-side queue that a small operator can manage in a dashboard.
2. **AMI / eligibility pre-qualifier.** GPMGLV operates LIHTC properties but discloses zero AMI thresholds publicly. A short, friendly "Am I eligible?" calculator (household size × gross income → "you qualify at 50% AMI") would *increase qualified application volume* for the operator AND *deflect unqualified applicants* before they enter the funnel.
3. **Unit-level inventory + live availability.** GPMGLV shows zero rent figures and zero availability dates. Even a static "1BR currently waitlist only — estimated 6 months" beats nothing. Live counters + filter-by-bedroom would 10× the listing UX.
4. **Position-aware waitlist.** GPMGLV's waitlist is a black hole — submit a form and wait. A position display (#142 of 287 for Dr. Paul Meacham 1BR) + a periodic status email is a clear product win, and aligns with the "plant-a-flag / claim-a-unit" UX in BP-03b.
5. **Resident portal with rent payment, document access, lease.** GPMGLV's portal does *only* maintenance + message + lookup. No payment, no docs, no lease, no rent ledger. This is a wide-open lane.
6. **Real auth, real applicant accounts.** No login anywhere on the tenant side. Frank-Pilot's "claimed unit becomes the carrot" thesis maps perfectly — anchor an account on the first action (waitlist join), follow through to apply → screen → deposit → tenant.
7. **EN/ES (and accessibility statement).** Las Vegas affordable housing has a large Spanish-speaking applicant base. GPMGLV ships English only with no language switcher. Hard-coded i18n is a major affordable-housing differentiator.
8. **Honest pricing/AMI disclosure.** Even a "rents range $XXX–$YYY based on AMI tier" line would build trust and reduce contact-form load for the operator.
9. **Sitemap + robots + structured data.** 404 on both `robots.txt` and `sitemap.xml` is leaving SEO on the table. JSON-LD `Apartment` / `HousingComplex` schema across 17 properties would help discovery.
10. **Honeypot / spam protection signal.** The unlabeled `Website` field on the waitlist form *might* be a honeypot, but more likely template residue. Frank-Pilot can ship clean, well-labeled forms with explicit anti-spam (Turnstile/hCaptcha or rate-limited backend) so the operator doesn't drown in junk submissions or accidentally collect garbage data.
11. **Eligibility-aware contact form.** The current "Community dropdown + Message" form gives the operator no structured signal. Frank-Pilot can replace it with a short qualifier (household size, income range, bedroom needed) that pre-routes the lead to the right property's waitlist *automatically*.
12. **Cookie banner / privacy compliance posture.** No cookie banner observed and no Set-Cookie in HEAD probes. Once Frank-Pilot adds session/auth cookies, GDPR/CCPA-style disclosure becomes table stakes — GPMGLV's privacy policy as it stands is too thin to cover an authenticated app.

## Crawl Log

| URL | Status | Bytes (approx) | Notes |
|---|---|---|---|
| https://gpmglv.com/ | 200 | 56,694 | Next.js + nginx + PleskLin; full nav + featured properties + contact form |
| https://gpmglv.com/robots.txt | 404 | 0 | not present |
| https://gpmglv.com/sitemap.xml | 404 | 0 | not present |
| https://gpmglv.com/sitemap_index.xml | 404 | 0 | not present |
| https://gpmglv.com/about-us | 200 | n/a | LIHTC mission, no forms |
| https://gpmglv.com/properties | 200 | n/a | 17 properties listed, filter chips |
| https://gpmglv.com/contact-us | 200 | n/a | 5-field contact form |
| https://gpmglv.com/join-waitlist | 200 | 42,354 | Waitlist form — full name, phone, current address, website (anomaly), date needed, apt type, pets, 16 property checkboxes |
| https://gpmglv.com/portal | 200 | n/a | Public dispatch, no login |
| https://gpmglv.com/portal/maintenance | 200 | 28,718 | 8-field maintenance form |
| https://gpmglv.com/portal/contact-management | 200 | n/a | 5-field contact-mgmt form |
| https://gpmglv.com/portal/lookup | 200 | n/a | Reference lookup; "REF-20260420-ABC123" |
| https://gpmglv.com/resources | 200 | n/a | External link directory only |
| https://gpmglv.com/privacy-policy | 200 | n/a | Generic, no processors named |
| https://gpmglv.com/terms-and-conditions | 200 | n/a | Generic terms, no operational language |
| https://gpmglv.com/apply | 404 | 0 | not present |
| https://gpmglv.com/available | 404 | 0 | not present |
| https://gpmglv.com/login | 200 | n/a | Staff splash, JS-rendered, Maintenance/Manager/Corporate sections, no static forms |
| https://gpmglv.com/login/maintenance | 404 | 0 | sub-route 404 |
| https://gpmglv.com/login/manager | 404 | 0 | sub-route 404 |
| https://gpmglv.com/login/corporate | 404 | 0 | sub-route 404 |
| https://gpmglv.com/homes/aldene-kline-barlow-senior-community | 200 | n/a | senior; 1-2BR; income-restricted |
| https://gpmglv.com/homes/david-j-hoggard-family-community | 200 | n/a | family; 1-2-3BR; amenities list |
| https://gpmglv.com/homes/donna-louise-apartments | 200 | n/a | family; built 2017; income-restricted |
| https://gpmglv.com/homes/donna-louise-2-apartments | 200 | n/a | family; income-restricted |
| https://gpmglv.com/homes/dr-luther-mack-jr-senior-community | 200 | n/a | senior; Studio/1-2-3BR |
| https://gpmglv.com/homes/dr-paul-meacham-senior-community | 200 | n/a | senior; 1-2BR |
| https://gpmglv.com/homes/ethel-mae-robinson-senior-apartments | 200 | n/a | senior; 1-2BR |
| https://gpmglv.com/homes/ethel-mae-fletcher-apartments | 200 | n/a | senior; 1-2BR; (linked next-community URL had typo to /mike-ocallaghan-apartments, untested) |
| https://gpmglv.com/homes/governor-mike-ocallaghan-apartments | 404 | 0 | slug appears to differ from canonical — direct fetch failed |
| https://gpmglv.com/homes/juan-garcia-garden-apartments | 200 | n/a | family; Studio/1-2-3BR |
| https://gpmglv.com/homes/louise-shell-senior-apartments | 200 | n/a | senior; 1-2BR |
| https://gpmglv.com/homes/owens-senior-housing | 200 | n/a | senior; 1-2BR |
| https://gpmglv.com/homes/sarann-knight-apartments | 200 | n/a | family; Studio/1-2-3BR |
| https://gpmglv.com/homes/senator-harry-reid-senior-apartments | 200 | n/a | senior; 1-2BR |
| https://gpmglv.com/homes/senator-richard-bryan-senior-apartments | 200 | n/a | senior; 1-2BR |
| https://gpmglv.com/homes/smith-williams-senior-apartments | 200 | n/a | senior; Studio/1-2-3BR |
| https://gpmglv.com/homes/yale-keyes-senior-apartments | 200 | n/a | senior; Studio/1-2-3BR |
| `curl -sI https://gpmglv.com/` | 200 | header probe | `server: nginx`, `x-powered-by: Next.js`, `x-powered-by: PleskLin`, `x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`, `cache-control: s-maxage=31536000`, no Set-Cookie |
| `curl -sI https://gpmglv.com/portal/maintenance` | 200 | header probe | same stack signature, no Set-Cookie |
| `curl -sI https://gpmglv.com/join-waitlist` | 200 | header probe | same stack signature, no Set-Cookie |
| `curl -sI https://gpmglv.com/login` | 200 | header probe | same stack signature BUT `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` (distinct from public pages) |

**Total successful page fetches via WebFetch: 26 (homepage + 4 main nav + waitlist + 4 portal + 3 footer + 14 property pages + 1 staff splash; 6 negatively confirmed 404s)**. **HEAD probes via curl: 4.** Cap of ~35 was respected.
