# Stage 2 Worksheet — Permit Dig, GPMG NV Portfolio (14 parcels, 4 AHJs — AHJ RESOLVED)

**For:** an operator or VA running permit searches by hand. ~10 min/parcel.
**Goal per parcel:** find any electrical record stating **service amperage / voltage / switchgear / CT cabinet**,
and ideally **transformer kVA**. Per the hard rule, **kVA is the only field that supports "Confirmed"**;
everything else is **inferred → "Likely" max** (`Inferred? = YES`).

> ✅ **AHJ resolved 2026-06-03** by point-in-polygon (each parcel's centroid vs. the Clark County `Cities`
> boundary layer — method + provenance at the bottom). The old "determine the AHJ yourself" step is **done**;
> each parcel below is already filed under its correct authority. Just open that portal and search.

> **Absence ≠ none.** If no permit appears, the record is *silent*, not proof of no service. That row stays
> **Unknown** until NV Energy answers — never infer "no service."

---

## Portal map (verified 2026-06-03)

| AHJ | Parcels | Portal | System | Scriptable? |
|-----|---------|--------|--------|-------------|
| **North Las Vegas** | 3 | `https://eg.cityofnorthlasvegas.com/EnerGov_Prod/SelfService#/search` | Tyler EnerGov | ❌ Cloudflare + CSRF (probes → HTTP 403) — manual |
| **City of Las Vegas** | 8 | Permit status / CLV Dashboard: `https://www.lasvegasnevada.gov/Business/Permits-Licenses/Building-Permits/Permit-Application-Status` | CLV proprietary | ⚠️ manual |
| **Unincorporated Clark County** | 2 | `https://aca-prod.accela.com/CLARKCO/Cap/CapHome.aspx?module=Building` | Accela Citizen Access | ⚠️ manual (search by parcel/address) |
| **Henderson** | 1 | `https://dsconline.cityofhenderson.com/energov_prod/selfservice#/home` | Tyler EnerGov | ❌ likely Cloudflare/CSRF like NLV — manual |

Common procedure (all sections): open portal → **Search** → **Permits**. Run **two passes** — by **address**,
then by **APN** — to catch records filed under either key. Filter to **Electrical**; also scan **Building**
permits (service detail often lives there). Screenshot each hit + save the record URL.

---

## §A — North Las Vegas (3 parcels) · Tyler EnerGov · manual

| Parcel | Pass A — address | Pass B — APN |
|--------|------------------|-------------|
| Donna Louise 1&2 | `6225 Donna` | `12426199007` |
| Owens Senior | `1626 Davis` | `13922810039` |
| Yale Keyes | `1705 Yale` | `13922899006` |

## §B — City of Las Vegas (8 parcels) · CLV Dashboard / permit status · manual

| Parcel | Pass A — address | Pass B — APN |
|--------|------------------|-------------|
| Aldene Kline Barlow / E.M. Robinson / Sarann Knight (3 bldgs, 1 APN) | `1327 H St` | `13928599064` |
| David J. Hoggard Family | `1100 W Monroe` | `13928599052` |
| Ethel Mae Fletcher | `1503 Laurelhurst` | `13825504002` |
| Mike O'Callaghan Legacy | `1502 Laurelhurst` | `13825599014` |
| Juan Garcia Garden | `2851 Sunrise` | `13936402015` |
| Louise Shell Senior | `2101 N MLK` | `13921699052` |
| Senator Harry Reid Senior | `328 N 11th` | `13935201001` |
| Senator Richard Bryan Senior | `2651 Searles` | `13925101022` |

## §C — Unincorporated Clark County (2 parcels) · Accela `CLARKCO` · manual
Both sit in the **Enterprise township** (south valley, 89123) — unincorporated, so **Clark County** is the
permitting authority despite the "Las Vegas" mailing address.

| Parcel | Pass A — address | Pass B — APN |
|--------|------------------|-------------|
| Luther Mack, Jr. Senior | `8158 Giles` | `17716101027` |
| Dr. Paul Meacham Senior | `65 E Windmill` | `17716199002` |

## §D — Henderson (1 parcel) · Tyler EnerGov (DSC Online) · manual

| Parcel | Pass A — address | Pass B — APN |
|--------|------------------|-------------|
| Smith Williams Senior | `575 E Lake Mead` | `17908399001` |

---

## Capture table (fill for every parcel, all sections)

| Parcel | AHJ | Permit # / record ID | Status | Issue date | **Service amps** | **Voltage / phase** | Switchgear / CT / meter config | **kVA stated?** | CO/TCO + final elec. inspection | Record URL |
|--------|-----|----------------------|--------|-----------|------------------|---------------------|-------------------------------|-----------------|----------------------------------|-----------|
| _(one row per parcel; add rows for parcels with multiple electrical permits)_ | | | | | | | | ☐ no ☐ YES → ___ kVA | | |

For the **multi-building parcels** (1327 H St ×3, Donna Louise ×2), note the **meter count** — baseline
assumption is one shared service per parcel; a permit showing multiple services overrides it.

---

## Tagging rule (apply to every captured field)
- **kVA stated outright** → candidate for **Confirmed**; record the value + the record URL as source.
- **amps / voltage / CT cabinet / switchgear / meter type only** → **inferred → "Likely" max**; set
  `Inferred? = YES` in the Stage-4 evidence table.

## Handoff back
Drop the filled capture rows into `electrical-service-validation.md` → **Stage 4 — Evidence table**, and set
each row's confidence per the rubric (Confirmed only on stated kVA or NV Energy; else Likely; else Unknown).

---

## Appendix — how the AHJ split was resolved (provenance)
Each parcel's polygon was pulled from the Clark County Assessor Parcels layer
(`…/Assessor/Layers/MapServer/1`), its area-weighted **centroid** computed, and that point tested against the
county **`Cities`** boundary layer (`…/CompPlanning/Cities/MapServer/0`, fields `NAME` / `PLACENAME`).
Rule: a `PLACENAME` with a **`CC ` prefix** (e.g. `CC Enterprise`) = unincorporated → **Clark County** is the
AHJ; no prefix = that **incorporated city**. Centroid (not full-polygon intersect) was used deliberately — a
point lands in exactly one jurisdiction, avoiding the boundary-edge false match seen on parcels that abut a
city line. The method was validated against the 4 known parcels (3 NLV + 1 Henderson) — all matched.

**Result:** North Las Vegas ×3 · City of Las Vegas ×8 · Unincorporated Clark County ×2 (Luther Mack, Dr. Paul
Meacham) · Henderson ×1.
