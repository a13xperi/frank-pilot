# Stage 2 Worksheet — Permit Dig, GPMG NV Portfolio (17 parcels, 4 AHJs — AHJ RESOLVED, OWNER-VERIFIED)

**For:** an operator or VA running permit searches by hand. ~10 min/parcel.
**Goal per parcel:** find any electrical record stating **service amperage / voltage / switchgear / CT cabinet**,
and ideally **transformer kVA**. Per the hard rule, **kVA is the only field that supports "Confirmed"**;
everything else is **inferred → "Likely" max** (`Inferred? = YES`).

> ✅ **APNs owner-verified 2026-06-03** against the Clark County Assessor detail page. **9 of the original 14
> first-pass APNs were wrong** (point-query hit adjacent slivers / stale "X99" master parcels) and are corrected
> below. Two earlier "shared parcel" assumptions were **reversed**: the **1327 H St campus = 3 separate parcels**
> (UT 1/2/3) and **Donna Louise 1 & 2 = 2 separate parcels** → **17 buildings = 17 parcels**.

> ✅ **AHJ resolved 2026-06-03** by point-in-polygon (each parcel's centroid vs. the Clark County `Cities`
> boundary layer — method + provenance at the bottom). Each parcel below is already filed under its correct
> authority. Just open that portal and search.

> **Absence ≠ none.** If no permit appears, the record is *silent*, not proof of no service. That row stays
> **Unknown** until NV Energy answers — never infer "no service."

---

## Portal map (verified 2026-06-03)

| AHJ | Parcels | Portal | System | Scriptable? |
|-----|---------|--------|--------|-------------|
| **North Las Vegas** | 4 | `https://eg.cityofnorthlasvegas.com/EnerGov_Prod/SelfService#/search` | Tyler EnerGov | ❌ Cloudflare + CSRF (probes → HTTP 403) — manual |
| **City of Las Vegas** | 10 | Permit status / CLV Dashboard: `https://www.lasvegasnevada.gov/Business/Permits-Licenses/Building-Permits/Permit-Application-Status` | CLV proprietary | ⚠️ manual |
| **Unincorporated Clark County** | 2 | `https://aca-prod.accela.com/CLARKCO/Cap/CapHome.aspx?module=Building` | Accela Citizen Access | ⚠️ manual (search by parcel/address) |
| **Henderson** | 1 | `https://dsconline.cityofhenderson.com/energov_prod/selfservice#/home` | Tyler EnerGov | ❌ likely Cloudflare/CSRF like NLV — manual |

Common procedure (all sections): open portal → **Search** → **Permits**. Run **two passes** — by **address**,
then by **APN** — to catch records filed under either key. Filter to **Electrical**; also scan **Building**
permits (service detail often lives there). Screenshot each hit + save the record URL.

---

## §A — North Las Vegas (4 parcels) · Tyler EnerGov · manual

| Parcel | Owner of record | Pass A — address | Pass B — APN |
|--------|-----------------|------------------|-------------|
| Donna Louise 1 | DONNALOUISE LLC | `6225 Donna` | `12426103004` |
| Donna Louise 2 | DONNA LOUISE 2 LLC | `6275 Donna` | `12426103002` |
| Owens Senior | OWENS 2 LP | `1626 Davis` | `13922810039` |
| Yale Keyes | YALE KEYES LP | `1705 Yale` | `13922810051` |

## §B — City of Las Vegas (10 parcels) · CLV Dashboard / permit status · manual

| Parcel | Owner of record | Pass A — address | Pass B — APN |
|--------|-----------------|------------------|-------------|
| Aldene Kline Barlow (UT 1) | CDPC NL LLC | `1327 H St` | `13928503028` |
| Ethel Mae Robinson (UT 2) | CDPC NL LLC | `1327 H St` | `13928503027` |
| Sarann Knight (UT 3) | CDPC NL LLC | `1327 H St` | `13928503026` |
| David J. Hoggard Family | SOUTHERN NV HOUSING AUTHORITY | `1100 W Monroe` | `13928503022` |
| Ethel Mae Fletcher ⚠ | VGAS 1 DCATUR LLC | `1503 Laurelhurst` | `13825504001` |
| Mike O'Callaghan Legacy ⚠ | 1501 LLC | `1502 Laurelhurst` | `13825518004` |
| Juan Garcia Garden | ERNIE CRAGIN LP | `2851 Sunrise` | `13936402015` |
| Louise Shell Senior | LSHP LP | `2101 N MLK` | `13921202007` |
| Senator Harry Reid Senior | 11TH STREET LP | `334 N 11th` (mail 328) | `13935201001` |
| Senator Richard Bryan Senior | SOUTHERN NV HOUSING AUTHORITY | `2651 Searles` | `13925101022` |

> ⚠️ **Fletcher** — leading with the exact situs match 1503 (`…504001`, 18u). A same-owner parcel `13825504002`
> at **1403** Laurelhurst (42u) also exists; if GPMG's "Fletcher" is the larger 1403 building, search that APN too.
> ⚠️ **O'Callaghan** — the operating 40-unit building (built 2025) is `…518004`. The adjacent `13825518005`
> (CDPC) is a **vacant** 3.25-ac lot — do not file the request on it.

## §C — Unincorporated Clark County (2 parcels) · Accela `CLARKCO` · manual
Both sit in the **Enterprise township** (south valley, 89123) — unincorporated, so **Clark County** is the
permitting authority despite the "Las Vegas" mailing address.

| Parcel | Owner of record | Pass A — address | Pass B — APN |
|--------|-----------------|------------------|-------------|
| Luther Mack, Jr. Senior | MIXED INCOME LLC | `8158 Giles` | `17716101027` |
| Dr. Paul Meacham Senior | MIXED INCOME 2 LLC | `65 E Windmill` | `17716101026` |

## §D — Henderson (1 parcel) · Tyler EnerGov (DSC Online) · manual

| Parcel | Owner of record | Pass A — address | Pass B — APN |
|--------|-----------------|------------------|-------------|
| Smith Williams Senior ⚠ | CHURCH COMMUNITY BAPTIST (fee owner) | `575 E Lake Mead` | `17908301011` |

> ⚠️ **Smith Williams** — fee owner is a church; GPMG likely holds a leasehold/ground lease. The permit and
> the NV Energy service account may be under the operator, not the fee owner.

---

## Capture table (fill for every parcel, all sections)

> ✅ **Captured 2026-06-08** — all 17 portal-scraped (NLV ×4 prior; CLV ×10 + Accela ×2 + Henderson ×1 this run).
> **Net: 0 of 17 records state kVA, amps, or voltage anywhere → 0 Confirmed flips; every row stays Likely/Unknown.**
> The only electrical *signal* is Sarann Knight's switchgear-plan record (names the component, not its rating).
> Detail by AHJ in `electrical-service-validation.md` **Stage 4c**. Service size → NV Energy Stage-4 (the only Confirmed path).

| Parcel | AHJ | Permit # / record ID | Status | Issue date | **Service amps** | **Voltage / phase** | Switchgear / CT / meter config | **kVA stated?** | CO/TCO + final elec. inspection | Record URL |
|--------|-----|----------------------|--------|-----------|------------------|---------------------|-------------------------------|-----------------|----------------------------------|-----------|
| Aldene Kline Barlow `…503028` | City of LV | L-33710 civil, L-44881 water, L22-01115 fiber/vault, L-36312/36052/34099/44563 revisions (7) | Completed/various | 2012–2022 | — | — (Likely 277/480 3φ, inferred) | none — OffSite/Planning only | ☐ no | n/a (civil) | CLV portal `ProjectsByParcel` |
| Ethel Mae Robinson `…503027` | City of LV | **0 records — literal `null`** (parcel pass); per GIS, 13 vertical permits incl **2× Electrical-Only** filed under the **address** | — | — | — | — (Likely 277/480 3φ, inferred) | not on parcel pass | ☐ no | — | CLV portal (parcel=null); address pass un-run |
| Sarann Knight `…503026` | City of LV | **L-39899 "SWG plan"** + L-39900 combo-utility, L-33704 civil, 34141-SDR, L-36313 rev, 35100-ZVL (6) | Inspections (L-39899) | — | — | — (Likely 120/208 3φ, inferred) | **switchgear plan named — no rating** → `Inferred? = YES` | ☐ no | — | CLV portal `ProjectsByParcel` |
| David J. Hoggard `…503022` | City of LV | 2173-SDR (100u senior), 4571-VAC drainage, 100800-ZVL (3) | Planning | 2024 (ZVL) | — | — (Likely 120/208 3φ, inferred) | none — Planning only | ☐ no | — | CLV portal `ProjectsByParcel` |
| Ethel Mae Fletcher 1503 `…504001` | City of LV | 53808-ZVL (covers `…504001` + `…504002`) | — | — | — | — (Likely 120/208 3φ, inferred) | none | ☐ no | — | CLV portal `ProjectsByParcel` |
| Fletcher alt 1403 `…504002` | City of LV | **0 records — literal `null`** (parcel pass); per GIS, commercial w/ Electrical-Only under the address | — | — | — | — (inferred 3φ) | not on parcel pass | ☐ no | — | CLV portal (parcel=null) |
| Mike O'Callaghan `…518004` | City of LV | **0 records — literal `null`** — reinforces GIS **0 vertical permits** → wrong-APN/vacant-lot flag ⚠ | — | — | — | — (inferred 277/480 3φ) | — | ☐ no | — | CLV portal (parcel=null) |
| Juan Garcia Garden `…402015` | City of LV | A-24085 landscape lic., L-27260 LVVWD valve, 77481-ZVL (3) | — | — | — | — (Likely 120/208 3φ, inferred) | none | ☐ no | — | CLV portal `ProjectsByParcel` |
| Louise Shell `…202007` | City of LV | A-22155/A-31045 landscape lic., L-37364 water main, L-45143 "D-LSB Locate Service – Backhoe" (4) | Completed (L-45143) | 2012-04-16 | — | — (Likely 120/208 3φ, inferred) | none — L-45143 is a dig-safe **locate**, *not* electrical service | ☐ no | — | CLV portal `ProjectsByParcel` |
| Senator Harry Reid `…201001` | City of LV | A-17316 landscape, A-32810/A-32819 alley-paving covenants (3) | — | — | — | — (Likely 120/208 3φ, inferred) | none — reconciles GIS "0 permits" (GIS omits Agreements) | ☐ no | — | CLV portal `ProjectsByParcel` |
| Senator Richard Bryan `…101022` | City of LV | 37346-ZVL (2651 Searles) (1) | — | — | — | — (Likely 120/208 3φ, inferred) | none — per GIS 61 permits incl **2× Electrical-Only** filed under the address | ☐ no | — | CLV portal `ProjectsByParcel` |
| Luther Mack, Jr. `17716101027` | Clark Co. (Accela) | **38 records** — Commercial Electric BD13-14515-EL3 ($500) + BD13-45283-EL3; Commercial Solar BD14-24663/24664/24665/24666-EL3; fire; 2024 plumbing | issued / final | 2013–14 | none stated | — (Likely 120/208 3φ; commercial elec + on-site PV) | none stated (ACA schema carries no service field) | ☐ no | occupied (CO present) | `aca-prod.accela.com/CLARKCO` |
| Dr. Paul Meacham `17716101026` | Clark Co. (Accela) | **31 records** — Commercial Electric BD13-40321-EL3 (main) + BD14-19185-EL3 (carport/solar); **85 kW carport solar BD14-24297-ELRV** | issued / final | 2013–14 | none stated | — (Likely 120/208 3φ; commercial elec + 85 kW PV) | none stated (ACA schema carries no service field) | ☐ no | occupied (CO present) | `aca-prod.accela.com/CLARKCO` |
| Smith Williams `17908301011` | Henderson (Tyler) | **portal unreachable** — `GetTenants` config API hangs → SPA never hydrates; GIS = carport shade-cover only (`480` = GUID false-positive) | — | — | — | — (Likely 120/208 3φ, inferred) | — | ☐ no | — | Tyler EnerGov (gated) → **deferred to NV Energy Stage-4** |
| Donna Louise 1 `…103004` | NLV (Tyler) | BD145340 Multi-Family-New + **elec BD150889 / BD153590 Commercial** | issued 2016/2017 | 2016–17 | gated (finding 8) | — (Likely 120/208 3φ, inferred) | gated (contact-login) | ☐ no | gated | NLV EnerGov (contact-gated) |
| Donna Louise 2 `…103002` | NLV (Tyler) | BD145341 Multi-Family-New + **elec BD150892 Commercial** (Submitted) + fire BUILD-003041-2025 | filed 2016 | 2016 | gated (finding 8) | — (Likely 120/208 3φ, inferred) | gated | ☐ no | gated | NLV EnerGov (contact-gated) |
| Owens Senior `13922810039` | NLV (Tyler) | **BD96712 Commercial-New (2008)** + BD11669 Commercial-Addition (2001) | issued 2008 | 2008 | gated (finding 8) | — (Likely 120/208 3φ, inferred) | gated — **2001 + 2008 structures → possibly 2 services** | ☐ no | gated | NLV EnerGov (contact-gated) |
| Yale Keyes `13922810051` | NLV (Tyler) | BD22311 Multi-Family-New (2002); ⚠ **DRY-010255-2020 "Dry Utility — NV Energy"** (plan-approval EXPIRED) | issued 2002 | 2002 | gated (finding 8) | — (Likely 120/208 3φ, inferred) | gated — lapsed 2020 NV Energy utility project | ☐ no | gated | NLV EnerGov (contact-gated) |

For the **1327 H St campus** (3 separate parcels, UT 1/2/3) and the **2 Donna parcels**, confirm whether each
parcel has **its own service** or whether the campus shares one — a permit showing the meter/service split
settles it. Do **not** assume one shared service (the earlier "shared parcel" reading was wrong).

---

## Tagging rule (apply to every captured field)
- **kVA stated outright** → candidate for **Confirmed**; record the value + the record URL as source.
- **amps / voltage / CT cabinet / switchgear / meter type only** → **inferred → "Likely" max**; set
  `Inferred? = YES` in the Stage-4 evidence table.

## Handoff back
Drop the filled capture rows into `electrical-service-validation.md` → **Stage 4 — Evidence table**, and set
each row's confidence per the rubric (Confirmed only on stated kVA or NV Energy; else Likely; else Unknown).

---

## Appendix — how the APNs + AHJ split were resolved (provenance)
**APN owner-verify:** each address was geocoded (Clark County composite locator), point-in-polygon'd against the
Assessor Parcels layer (`…/Assessor/Layers/MapServer/1`), and the resulting APN confirmed on the **Assessor
detail page** (`parceldetail.aspx?hdnParcel=<APN>`) by matching situs + owner + use + unit count. The first-pass
single-point pull was wrong for 9 of 14 parcels (it hit adjacent slivers / stale "X99" master parcels with no
assessment record); the owner record is the authoritative tiebreak.

**AHJ split:** each parcel's area-weighted **centroid** was tested against the county **`Cities`** boundary
layer (`…/CompPlanning/Cities/MapServer/0`, fields `NAME` / `PLACENAME`). Rule: a `PLACENAME` with a **`CC `
prefix** (e.g. `CC Enterprise`) = unincorporated → **Clark County** is the AHJ; no prefix = that incorporated
city. Centroid (not full-polygon intersect) avoids boundary-edge false matches. Validated against the 5 known
parcels (4 NLV + 1 Henderson) — all matched.

**Result:** North Las Vegas ×4 · City of Las Vegas ×10 · Unincorporated Clark County ×2 (Luther Mack, Dr. Paul
Meacham) · Henderson ×1 = **17 parcels**.
