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

| Parcel | AHJ | Permit # / record ID | Status | Issue date | **Service amps** | **Voltage / phase** | Switchgear / CT / meter config | **kVA stated?** | CO/TCO + final elec. inspection | Record URL |
|--------|-----|----------------------|--------|-----------|------------------|---------------------|-------------------------------|-----------------|----------------------------------|-----------|
| _(one row per parcel; add rows for parcels with multiple electrical permits)_ | | | | | | | | ☐ no ☐ YES → ___ kVA | | |

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
