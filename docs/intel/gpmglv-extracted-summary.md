# gpmglv.com — Full-Scrape Extraction Summary

_Snapshot: 2026-05-22. Scraper: `scripts/scrape-gpmglv.mjs`. Extractor: `scripts/extract-gpmglv.mjs`. Structured outputs: `gpmglv-properties-extracted.json` + `gpmglv-site-extracted.json`._

This is a delta on top of the May 21 audit (`gpmglv-audit.md`) — read that first. The goal here is to surface (a) facts the audit missed, (b) per-property data quality, and (c) which seed fields to add to the Frank-Pilot tenant portal.

## Crawl outputs at a glance

| Metric | Value |
|---|---|
| Pages fetched | 72 (incl. 4 sitemap-discovered images endpoints) |
| Property pages | 17 (audit was 16; corrected slug `mike-ocallaghan-apartments` not `governor-mike-ocallaghan-apartments`) |
| Property images downloaded | 18 hero images (all sourced from `/uploads/`) |
| Total images (incl. logos/icons) | 77 |
| Failures | 0 |
| Time | ~70s end-to-end |

Raw HTML + images: `docs/intel/raw/gpmglv/2026-05-22/` (gitignored).

## New facts since the May 21 audit

1. **The correct slug is `mike-ocallaghan-apartments`, not `governor-mike-ocallaghan-apartments`.** The audit recorded the latter as a 404 — this scrape proved the former resolves with 200. There are **17 properties, not 16** (the footer's "We manage 16 communities" is stale copy).
2. **`applicantName` and `phone` ARE marked `required` on the waitlist form.** The audit said "no required attributes detected on any field". Only those two are required; the other 8 fields (incl. `applicantAddress`, `dateNeeded`, `aptTypes`, `pets`, plus the 17 property checkboxes) are loose.
3. **The waitlist `pets` field has placeholder text `"None, Dog, Cat, etc."`** — meaningful product signal: pet info is collected as free-text, not structured.
4. **The waitlist has 21 checkboxes total: 4 named (`aptTypes` = studio/1br/2br/3br) + 17 anonymous (property selectors).** Confirms the corrected 17-property count.
5. **10 of 17 properties publish a fax number** verbatim on their page (in the embedded structured payload). The audit did not pull these. Frank-Pilot could use this as a "they're really analog" signal.
6. **Every property page embeds full structured prev/current/next nav data** as escaped JSON (`\"slug\":\"...\",\"address\":\"...\",\"city\":\"...\",\"phone\":\"...\",\"fax\":\"...\",\"description\":\"...\",\"type\":\"...\",\"image\":\"...\"`). This is the cleanest source of per-property data — better than scraping the visible DOM, which always shows the **corporate** address (`2009 Alta Drive`) in the leasing-office block. The extractor consumes this payload as its primary source.
7. **3 properties share the same street address (`1327 H Street, Las Vegas, NV 89106`)**: Aldene Kline, Ethel Mae Robinson, Sarann Knight. Likely a co-located campus / multi-building site. Worth confirming against operator data — but Frank-Pilot's seed currently treats them as 3 distinct addresses.
8. **Donna Louise & Donna Louise 2 share both address (`6225 Donna St., North Las Vegas, NV 89081`) and phone (`(702) 920-6548`).** Confirms they're sister properties on one campus.
9. **The corporate phone `(702) 873-8882` is reused for the Mike O'Callaghan listing** as its primary contact. Either it's actually managed direct from corporate, or it's a data-entry gap on their site.
10. **One property (`dr-paul-meacham`) uses a toll-free 877 number, not a Vegas local 702.** Frank-Pilot should preserve this verbatim, not normalize it.
11. **The Aldene Kline page shows leasing-office hours `"Mon–Sat 9a–6p • Sun by appt."`** — every other property page shows the generic boilerplate `"Please call for current office hours and tour availability."`. Either Aldene Kline really has these hours, or it's template residue. Either way Frank-Pilot can ship it verbatim and outperform "please call".
12. **The Hoggard page shows `"Open 7 days a week"`** as its hours. Also a one-off vs the boilerplate.
13. **`donna-louise-2-apartments` uses `/uploads/coming-soon.svg` as its primary image** — the property is genuinely still under construction / image-pending. Frank-Pilot's seed should NOT use a real photo for this one.
14. **Some addresses use abbreviated state-style strings**: `"N. Las Vegas, NV 89030"` (Owens, Yale Keyes) vs `"North Las Vegas, NV 89081"` (Donna Louise). The extractor normalizes `N. Las Vegas → North Las Vegas` automatically — Frank-Pilot's seed should use the normalized form.
15. **The contact page embeds a Google Maps iframe** at the corporate address (`2009 Alta Drive`). Audit said "no iframes" — that was only true of property pages.
16. **The contact form has `placeholder` text for every field** (`"Your full name"`, `"(702) 555-0000"`, `"you@email.com"`, `"Tell us how we can help..."`). The audit missed the placeholders. None of the inputs have `name=` attributes — they're all anonymous React-managed fields posting through a handler.
17. **The robots.txt and sitemap.xml are still 404** as of this scrape. No change since audit.

## Per-property data quality grid

Legend: `✓` = present, `✗` = missing or placeholder. `Hours-real` = anything other than the generic "Please call for current office hours" boilerplate.

| Slug | Type | Desc | Amen | Photos | Fax | Hours-real | Phone |
|---|---|:-:|:-:|:-:|:-:|:-:|---|
| aldene-kline-barlow-senior-community | senior | ✓ | 8 | 5 | ✗ | ✓ | (702) 920-6550 |
| david-j-hoggard-family-community | family | ✓ | 7 | 5 | ✗ | ✓ | (702) 648-6946 |
| donna-louise-2-apartments | family | ✓ | 6 | 1 | ✗ | ✗ | (702) 920-6548 |
| donna-louise-apartments | family | ✓ | 8 | 5 | ✗ | ✗ | (702) 920-6548 |
| dr-luther-mack-jr-senior-community | senior | ✓ | 7 | 5 | ✗ | ✗ | (702) 920-6569 |
| dr-paul-meacham-senior-community | senior | ✓ | 8 | 5 | ✗ | ✗ | (877) 895-8207 |
| ethel-mae-fletcher-apartments | family | ✓ | 8 | 5 | ✓ | ✗ | (702) 920-6572 |
| ethel-mae-robinson-senior-apartments | senior | ✓ | 8 | 3 | ✓ | ✗ | (702) 834-6565 |
| juan-garcia-garden-apartments | family | ✓ | 8 | 5 | ✓ | ✗ | (702) 383-6180 |
| louise-shell-senior-apartments | senior | ✓ | 8 | 4 | ✓ | ✗ | (702) 646-4802 |
| mike-ocallaghan-apartments | family | ✓ | 8 | 5 | ✗ | ✗ | (702) 873-8882 |
| owens-senior-housing | senior | ✓ | 8 | 1 | ✓ | ✗ | (702) 642-0896 |
| sarann-knight-apartments | family | ✓ | 8 | 5 | ✓ | ✗ | (702) 538-9031 |
| senator-harry-reid-senior-apartments | senior | ✓ | 8 | 5 | ✓ | ✗ | (702) 383-1091 |
| senator-richard-bryan-senior-apartments | senior | ✓ | 8 | 5 | ✓ | ✗ | (702) 649-3508 |
| smith-williams-senior-apartments | senior | ✓ | 7 | 5 | ✓ | ✗ | (702) 382-3726 |
| yale-keyes-senior-apartments | senior | ✓ | 7 | 5 | ✓ | ✗ | (702) 642-7758 |

### Stakeholder-grade content tally

| Field | Coverage |
|---|---|
| Description (`description`) | 17/17 (100%) — all useful, 60–150 chars |
| Address (`address.line1`) | 17/17 (100%) |
| Phone | 17/17 (100%) |
| Amenities ≥ 5 bullets | 17/17 (100%) — 130 amenity bullets total |
| Photos ≥ 3 | 15/17 (88%) — Owens (1) and Donna Louise 2 (1, coming-soon.svg) are the gaps |
| Fax | 10/17 (59%) — verbatim from operator |
| Real office hours | 2/17 (12%) — only Aldene Kline + Hoggard; the rest are "please call" boilerplate |
| AMI / rent disclosed | 0/17 (0%) — confirms audit |
| Property type | 17/17 — 10 senior / 7 family |
| Cities | 12 Las Vegas / 4 North Las Vegas / 1 Henderson |

## Cross-property anomalies

- **Shared addresses (3):** Aldene Kline + Ethel Mae Robinson + Sarann Knight all at `1327 H Street, Las Vegas, NV 89106`. Three property pages, one address.
- **Shared address + phone (2):** Donna Louise + Donna Louise 2 at `6225 Donna St., North Las Vegas, NV 89081` and `(702) 920-6548`.
- **Corporate phone reused as a property's primary contact (1):** Mike O'Callaghan uses `(702) 873-8882` (the corporate switchboard).
- **Toll-free phone (1):** Dr. Paul Meacham uses `(877) 895-8207`.
- **Properties with NO real images (2):** Owens (1 image), Donna Louise 2 (1 placeholder SVG).
- **Properties with explicit hours (2):** Aldene Kline (`"Mon–Sat 9a–6p • Sun by appt."`), Hoggard (`"Open 7 days a week"`). Possibly template residue; treat as low-confidence.

## Recommended seed-schema enrichments

The other in-flight session owns `src/db/schema.ts` and `src/db/seed.ts` — these are **recommendations, not implementations**. When that work lands, the schema should add:

```ts
// Recommended additions to the property/community table:
description       TEXT,                  // 60–150 char operator-supplied marketing prose (17/17 available)
tagline           TEXT,                  // optional "Why Choose…" hook (extractable from 17/17)
amenities         TEXT[],                // 6–8 bullets per property (avg 7.6, 17/17 ≥ 5)
photo_urls        TEXT[],                // hero + gallery (avg 4.4, 15/17 ≥ 3)
primary_photo_url TEXT,                  // hero for cards (17/17 — one is a coming-soon placeholder)
property_type     TEXT,                  // 'senior' | 'family'  (17/17)
fax               TEXT,                  // verbatim, only set when disclosed (10/17)
office_hours      TEXT,                  // verbatim (only 2/17 have non-boilerplate)
office_hours_source TEXT,                // 'operator' | 'boilerplate' — track confidence
waitlist_url      TEXT,                  // pre-built `/join-waitlist?property=<slug>` (17/17)
accessibility_features TEXT[],           // "ADA accommodations", "Elevator access", "Equal Housing Opportunity"
unit_types        TEXT[],                // ['Studio','1BR','2BR','3BR'] subset
slug              TEXT UNIQUE,           // url-safe slug (17/17 from the source site)
```

For each property, the JSON file `docs/intel/gpmglv-properties-extracted.json` has fully-populated entries ready to map directly into seed rows.

### Sample mapping (Louise Shell)

```ts
{
  slug: 'louise-shell-senior-apartments',
  name: 'Louise Shell Senior Apartments',
  description: 'Senior apartments on MLK Boulevard, offering accessible living in a community-focused environment.',
  address: { line1: '2101 N. Martin Luther King Blvd.', city: 'Las Vegas', state: 'NV', zip: '89106' },
  phone: '(702) 646-4802',
  fax: '(702) 646-0964',
  property_type: 'senior',
  amenities: [
    'One & two-bedroom senior apartments',
    'Elevator access & ADA accommodations',
    'Community room with activities & programs',
    'Laundry facilities on site',
    'Secure entry & on-site management',
    'Close to groceries & neighborhood services',
    'Convenient access to nearby medical services',
    'RTC bus routes along MLK Blvd and nearby corridors',
  ],
  accessibility_features: ['Reasonable accommodations available upon request', 'ADA accommodations available', 'Elevator access', 'Equal Housing Opportunity'],
  primary_photo_url: 'https://gpmglv.com/uploads/2024/11/LS.png',
  unit_types: ['1BR', '2BR'],
  waitlist_url: 'https://gpmglv.com/join-waitlist?property=louise-shell-senior-apartments',
}
```

## Items intentionally NOT changed in this PR

- `src/db/schema.ts`, `src/db/seed.ts`, `src/modules/applicants/routes.ts`, `client-tenant/src/pages/apply/**`, `client-tenant/src/components/UnitCard.tsx`, `client-tenant/src/pages/Apply.tsx`, `client-tenant/src/i18n/{en,es}/apply.json`, `src/modules/tape/routes.ts` — owned by other in-flight sessions.
- Per-property amenity normalization (e.g., extracting "Elevator", "ADA", "On-site laundry" as canonical tags). Current extraction preserves the operator's verbatim wording, which is what stakeholders want to see.
- Spanish translations of the prose. Frank-Pilot's i18n step (separate PR) should handle that.

## How to refresh

```bash
# Re-fetch only changed pages (uses ETag / Last-Modified):
node scripts/scrape-gpmglv.mjs

# Force a full re-fetch:
node scripts/scrape-gpmglv.mjs --force

# Single page:
node scripts/scrape-gpmglv.mjs --page=/homes/louise-shell-senior-apartments

# Skip images (HTML only):
node scripts/scrape-gpmglv.mjs --no-images

# Re-run the extractor against the latest snapshot:
node scripts/extract-gpmglv.mjs
```

The scraper is polite (500ms delay, 1 retry on 5xx, aborts on 3 consecutive 5xx), idempotent (re-running with no flags only re-fetches changed pages), and capped at 80 pages by default.
