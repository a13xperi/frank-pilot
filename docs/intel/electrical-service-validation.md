# Electrical Service Validation — GPMG North Las Vegas

**Created:** 2026-06-03
**Goal:** Cross-validate proposed electrical service assumptions per building and identify the
authoritative source needed to confirm transformer size.
**Scope:** Primary deep-dive = North Las Vegas GPMG properties — Stages 2–4 below.
**Stage 1 (APN) extended + OWNER-VERIFIED live for all 17 GPMG buildings → 17 distinct parcels across 4 permit
jurisdictions** (see "Stage 1 (extended)"). All 17 owners-of-record confirmed via the Assessor detail page
2026-06-03; **9 of the original first-pass APNs were wrong and have been corrected** — see the correction note.

## Hard rule (governs every "Confidence" value)

> Transformer size is **never** marked "Confirmed" unless a record states transformer **kVA explicitly**,
> or **NV Energy** confirms it. Amperage / meter type / CT cabinet / switchgear → **"Likely" at best**,
> and **always flagged as inferred** (see the "Inferred?" column).

## The three sources — what each can and cannot prove

| Source | Proves | Access mechanics | Authoritative for transformer kVA? |
|--------|--------|------------------|------------------------------------|
| **Clark County Assessor** (ArcGIS REST) | APN, parcel geometry/acreage, tax district | **Scriptable** — query Parcels layer by point/address, JSON out | ❌ Parcel/property validation only |
| **NLV EnerGov Self-Service** | Electrical permits, service upgrades, plan review, CO/TCO, inspections | Public but **browser/CSRF-gated** → manual click-through | ⚠️ Only if a permit *explicitly* records kVA |
| **NV Energy** (service planning) | **Actual transformer kVA on the service** | **Owner-authorized outbound request** — no public API | ✅ The only true authority |

### Verified endpoints (Stage 1, scriptable)
- ArcGIS root: `https://maps.clarkcountynv.gov/arcgis/rest/services`
- Parcels layer: `…/Assessor/Layers/MapServer/1/query` — point-in-polygon by `lng,lat` (inSR 4326), `outFields=*`
  returns `APN`, `ASSR_ACRES`, `TAX_DIST`.
- Assessor public real-property record (owner/assessment/building, manual): start at
  `https://www.clarkcountynv.gov/government/assessor/property_search/real-property-records`, search by APN.

---

## Stage 1 — Normalize + APN + owner-verify  ✅ DONE (scripted, live, owner-verified)

Method: county composite geocoder → ArcGIS point-in-polygon → **Assessor detail page owner-verify**
(`parceldetail.aspx?hdnParcel=<APN>`). The owner-verify step is essential — see the correction note below.

**North Las Vegas — 4 parcels (owner-verified 2026-06-03):**

| Property | Address | ZIP | APN | Owner of record | Units | Acres | Built |
|----------|---------|-----|-----|-----------------|-------|-------|-------|
| Donna Louise **1** | 6225 Donna St | 89081 | **12426103004** | DONNALOUISE LLC | 48 | 2.07 | 2017 |
| Donna Louise **2** | 6275 Donna St | 89081 | **12426103002** | DONNA LOUISE 2 LLC | 48 | — | 2025 |
| Owens Senior Housing | 1626 Davis Pl | 89030 | **13922810039** | OWENS 2 LP | 72 | 3.89 | 2001 |
| Yale Keyes Senior Apts | 1705 Yale St | 89030 | **13922810051** | YALE KEYES LP | 70 | 6.89 | 2003 |

> ⚠️ **Correction (2026-06-03): the "Donna 1 & 2 = one parcel" collapse was WRONG.** Donna Louise 1
> (6225 Donna St, `12426103004`, DONNALOUISE LLC, 48u, blt 2017) and Donna Louise 2 (6275 Donna St,
> `12426103002`, DONNA LOUISE 2 LLC, 48u, blt **2025**) are **two distinct parcels with separate ownership
> SPEs**, built eight years apart → almost certainly **two separate services**. The earlier "one APN"
> reading came from a wrong first-pass APN (`12426199007`, a stale GIS parcel with no assessment record).
> Donna, Owens, and Yale are all distinct parcels in the 89030/89081 pocket.

**Confidence on parcel data: Confirmed (owner-verified).** (Assessor is authoritative for APN/parcel/owner — **not** for electrical/transformer.)

### ⚠️ Correction note — first-pass point-query was unreliable (9 of 14 APNs wrong)
The original Stage-1 single-point-in-polygon pull landed on **adjacent slivers, common-area, or stale
"X99" master parcels with no assessment record** for **9 of the 14 first-pass APNs**. Every failing APN
shared the block pattern `…X99…` and returned *"No record found"* from the Assessor. Re-resolving each from
its street address (county geocoder → ArcGIS → Assessor owner-verify) recovered the true assessed parcel,
confirmed by exact situs + owner + use + unit-count match. **Owner-verification via the Assessor detail page
is mandatory — the first-pass point hit cannot be trusted on its own.** Corrected APNs are in the master
table below; the wrong→right mapping: Donna `12426199007→12426103004` (+Donna 2 `12426103002`),
Yale `13922899006→13922810051`, Aldene/H-St `13928599064→13928503028/027/026`,
Hoggard `13928599052→13928503022`, Meacham `17716199002→17716101026`,
Fletcher (1503) `→13825504001`, O'Callaghan `13825599014→13825518004`,
Louise Shell `13921699052→13921202007`, Smith Williams `17908399001→17908301011`,
Bryan `13925297003→13925101022`.

### Stage 1 (extended) — all 17 GPMG buildings → 17 parcels, 4 jurisdictions  ✅ DONE + OWNER-VERIFIED (2026-06-03)

Every row owner-verified against the **Clark County Assessor detail page** (`parceldetail.aspx?hdnParcel=<APN>`):
owner-of-record, situs, use code, dwelling units, year built. APNs are the **corrected** values (9 first-pass
APNs were wrong — see correction note above). Acreage is Assessor-stated where present.

| # | Building | Situs (Assessor) | ZIP | **APN** | Owner of record | Units | Use | Acres | Built | AHJ |
|---|----------|------------------|-----|---------|-----------------|-------|-----|-------|-------|-----|
| 1 | Aldene Kline Barlow | 1327 H St UT 1 | 89106 | **13928503028** | CDPC NL LLC | 39 | 34.150 hi-rise | — | 2013 | City of LV |
| 2 | Ethel Mae Robinson | 1327 H St UT 2 | 89106 | **13928503027** | CDPC NL LLC | 82 | 34.150 hi-rise | 2.80 | 2009 | City of LV |
| 3 | Sarann Knight | 1327 H St UT 3 | 89106 | **13928503026** | CDPC NL LLC | 38 | 33.150 lo-rise | — | 2011 | City of LV |
| 4 | David J. Hoggard Family | 1100 W Monroe Ave | 89106 | **13928503022** | SOUTHERN NV HOUSING AUTHORITY | 100 | 33.150 | 5.78 | 2005 | City of LV |
| 5 | Donna Louise **1** | 6225 Donna St | 89081 | **12426103004** | DONNALOUISE LLC | 48 | 33.150 | 2.07 | 2017 | North Las Vegas |
| 6 | Donna Louise **2** | 6275 Donna St | 89081 | **12426103002** | DONNA LOUISE 2 LLC | 48 | 33.150 | — | 2025 | North Las Vegas |
| 7 | Luther Mack, Jr. Senior | 8158 Giles St (Enterprise) | 89123 | **17716101027** | MIXED INCOME LLC | 48 | 33.150 | 2.25 | 2014 | Unincorp. Clark Co. |
| 8 | Dr. Paul Meacham Senior | 65 E Windmill Ln (Enterprise) | 89123 | **17716101026** | MIXED INCOME 2 LLC | 57 | 33.150 | 1.93 | 2014 | Unincorp. Clark Co. |
| 9 | Ethel Mae Fletcher | 1503 Laurelhurst Dr | 89108 | **13825504001** ⚠ | VGAS 1 DCATUR LLC | 18 | 33.150 | 1.32 | 2016 | City of LV |
| 10 | Mike O'Callaghan Legacy | 1502 Laurelhurst Dr | 89108 | **13825518004** ⚠ | 1501 LLC | 40 | 34.150 hi-rise | 2.22 | 2025 | City of LV |
| 11 | Juan Garcia Garden | 2851 Sunrise Ave | 89101 | **13936402015** | ERNIE CRAGIN LP | 52 | 33.150 | 2.94 | 2002 | City of LV |
| 12 | Louise Shell Senior | 2101 N MLK Blvd | 89106 | **13921202007** | LSHP LP | 100 | 33.150 | 6.16 | 2003 | City of LV |
| 13 | Owens Senior Housing | 1626 Davis Pl | 89030 | **13922810039** | OWENS 2 LP | 72 | 33.150 | 3.89 | 2001 | North Las Vegas |
| 14 | Senator Harry Reid Senior | 334 N 11th St (mail 328) | 89101 | **13935201001** | 11TH STREET LP | 100 | 33.150 | 2.58 | 2004 | City of LV |
| 15 | Senator Richard Bryan Senior | 2651 Searles Ave | 89101 | **13925101022** | SOUTHERN NV HOUSING AUTHORITY | 165 | 33.150 | 6.08 | 2007 | City of LV |
| 16 | Smith Williams Senior | 575 E Lake Mead Pkwy (Henderson) | 89015 | **17908301011** | CHURCH COMMUNITY BAPTIST ⚠ | 80 | 33.150 | 4.98 | 2011 | Henderson |
| 17 | Yale Keyes Senior | 1705 Yale St | 89030 | **13922810051** | YALE KEYES LP | 70 | 33.150 | 6.89 | 2003 | North Las Vegas |

**~1,157 dwelling units across 17 buildings = 17 distinct parcels (≈1:1).** Both earlier "collapse"
assumptions were artifacts of wrong first-pass APNs and are **reversed**:
- **1327 H St campus = 3 separate parcels** (UT 1/2/3 → `…503028` / `…503027` / `…503026`, all CDPC NL LLC,
  159 units total) — likely **3 separate services**, not one shared. Confirm meter topology at Stage 2/NV Energy.
- **Donna Louise 1 & 2 = 2 separate parcels / 2 SPEs** (`…103004` 2017 + `…103002` 2025) → likely 2 services.

**⚠️ Two parcels need a GPMG ownership confirmation (multiple same-situs parcels on the block):**
- **Fletcher** — roster "1503 Laurelhurst" = `13825504001` (VGAS 1 DCATUR LLC, **18u**). An adjacent
  **same-owner** parcel `13825504002` (1403 Laurelhurst, VGAS, **42u**, 2016) also exists. Leading with the
  exact situs match (1503 → `…504001`); confirm whether GPMG's "Fletcher" is the 18u (1503) or 42u (1403) building.
- **O'Callaghan** — the operating **40-unit** building (hi-rise, **built 2025**) is `13825518004` (owner "1501 LLC").
  The adjacent `13825518005` (CDPC, 3.25 ac) is **VACANT COMMERCIAL, 0 units** — development land / future phase.
  The first pass had O'Callaghan pinned to that vacant lot. Confirm GPMG operates `…518004`.

**Stage 2 permit dig splits across 4 AHJs — all SOP'd; AHJ of every parcel resolved:**

| AHJ | Parcels | Stage 2 portal |
|-----|---------|----------------|
| North Las Vegas | **4** (Donna 1, Donna 2, Owens, Yale) | NLV EnerGov (Tyler) — Cloudflare/CSRF, manual ✅ |
| **City of Las Vegas** | **10** (H St ×3, Hoggard, Fletcher, O'Callaghan, Juan Garcia, Louise Shell, Harry Reid, Bryan) | CLV Dashboard / permit status — manual ✅ |
| **Unincorporated Clark County** | **2** (Luther Mack, Dr. Paul Meacham — Enterprise twp) | Clark Co. Accela `CLARKCO` — manual ✅ |
| Henderson | 1 (Smith Williams) | Henderson EnerGov (DSC Online, Tyler) — manual ✅ |

> ✅ **AHJ trap RESOLVED (2026-06-03).** The "Las Vegas"-mailing parcels were split by point-in-polygon
> (parcel centroid vs. county `Cities` boundary layer): **City of Las Vegas vs unincorporated Clark
> County** — Luther Mack (`17716101027`) and Dr. Paul Meacham (`17716101026`) are unincorporated, both in the
> Enterprise township (89123). Method validated against the 5 known parcels (4 NLV + 1 Henderson, all matched).
> Per-parcel filing in [`permit-stage2-worksheet.md`](./permit-stage2-worksheet.md) §A–§D.

> ✅ **All 17 owner-verified (2026-06-03).** The first-pass single-point ArcGIS pull mis-hit **9 of 14**
> parcels (adjacent slivers / common-area / stale "X99" master parcels with no assessment record). Each was
> re-resolved from its street address (county geocoder → ArcGIS point-in-polygon → **Assessor owner record**,
> the authoritative tiebreak) and confirmed by exact situs + owner + use + unit-count. Example: Bryan's
> first-pass `13925297003` was a 0.015-ac sliver → real parcel `13925101022` (SOUTHERN NV HOUSING AUTHORITY,
> 6.08 ac, 165 units, blt 2007). Source per row: `parceldetail.aspx?hdnParcel=<APN>`.

---

## Stage 2 — Permit dig (4 AHJs, portfolio) — MANUAL CHECKLIST

> 📄 **Operator worksheet:** [`permit-stage2-worksheet.md`](./permit-stage2-worksheet.md) — all **17 parcels**
> split by AHJ (NLV / City of LV / unincorporated Clark County / Henderson), pre-filled search keys + capture
> table, ~10 min/parcel. Portal map verified 2026-06-03. Both EnerGov portals (NLV + Henderson) sit behind
> Cloudflare + CSRF (JSON probes → HTTP 403) → not scriptable, use a real browser.
> ⚠️ The worksheet predates the 2026-06-03 owner-verify pass — **re-key it to the corrected APNs in the
> master table above** (9 APNs changed; H St = 3 parcels; Donna = 2 parcels) before filing.

Portals: NLV EnerGov `eg.cityofnorthlasvegas.com/EnerGov_Prod/SelfService` · City of LV CLV Dashboard ·
Clark Co. Accela `aca-prod.accela.com/CLARKCO` · Henderson EnerGov `dsconline.cityofhenderson.com`.
(All public, all manual — see worksheet for the per-AHJ split and determination method.)

Per parcel (same procedure across all AHJs):

1. Open the portal → **Search** → **Permits** tab.
2. Search by **address** first (e.g. `6225 Donna`), then re-run by **parcel/APN** to catch records filed under either key.
3. Filter to **Electrical** permit type. Also scan **Building** permits for new-construction / service-upgrade scope.
4. For each hit, capture into the evidence table:
   - Permit # / record ID, status, issue date
   - **Service amperage** (e.g. 400A, 800A, 1200A)
   - **Voltage / phase** (120/208 3Φ, 277/480 3Φ, etc.)
   - Service-upgrade scope, **CT cabinet**, **switchgear**, meter configuration
   - CO / TCO and final electrical inspection result
   - Screenshot + the record URL
5. **Tag every electrical field by transformer-relevance:**
   - kVA stated outright → candidate for **Confirmed**
   - amperage / CT cabinet / switchgear / meter type only → **inferred → "Likely" max**, set `Inferred? = YES`

> EnerGov records frequently predate the building or only cover the most recent permit. Absence of a permit
> ≠ absence of service — it means the record is silent, so the row stays **Unknown** until NV Energy answers.

---

## Stage 3 — NV Energy confirmation (the only path to "Confirmed")

NV Energy transformer kVA is **not** in any public record. It requires an owner-authorized
service-planning / facility-confirmation request.

> 📄 **Send-ready request:** [`nv-energy-service-request.md`](./nv-energy-service-request.md) — **portfolio
> version, all 17 parcels** pre-filled (one utility serves all). **All 17 owners-of-record are now verified**
> (2026-06-03) — authorization can be obtained per owner entity (see owner list below). Two flags before
> sending: **O'Callaghan** owner = "1501 LLC" on the built parcel `…518004` (not the adjacent CDPC vacant lot),
> and **Smith Williams** fee owner = CHURCH COMMUNITY BAPTIST (likely ground lease — the NV Energy service-account
> holder may be the GPMG leaseholder, confirm). ⚠️ Re-key this file to the corrected APNs before sending.
>
> **Owners by entity:** CDPC NL LLC (Aldene/Robinson/Knight) · SOUTHERN NV HOUSING AUTHORITY (Hoggard, Bryan) ·
> DONNALOUISE LLC + DONNA LOUISE 2 LLC · MIXED INCOME LLC + MIXED INCOME 2 LLC (Luther Mack, Meacham) ·
> VGAS 1 DCATUR LLC (Fletcher) · 1501 LLC (O'Callaghan) · ERNIE CRAGIN LP (Juan Garcia) · LSHP LP (Louise Shell) ·
> OWENS 2 LP · 11TH STREET LP (Harry Reid) · CHURCH COMMUNITY BAPTIST (Smith Williams ⚠) · YALE KEYES LP.

Draft below (mirrored in the send-ready file) — fill the bracketed fields, send from (or CC) the property
owner/authorized agent so NV Energy will release facility data.

```
To: NV Energy — Service Planning / Builder Services
From: [Owner / authorized agent name, GPMG], [email], [phone]
Re: Existing electrical service & transformer confirmation — North Las Vegas parcels (sample)

We are validating the existing electrical service for the following GPMG-affiliated multifamily
properties and request the existing service size and transformer rating (kVA) of record for each
(NLV sample shown; full 17-parcel list in the send-ready file):

  1. Donna Louise 1   — 6225 Donna St, North Las Vegas, NV 89081 — APN 12426103004 (DONNALOUISE LLC)
  2. Donna Louise 2   — 6275 Donna St, North Las Vegas, NV 89081 — APN 12426103002 (DONNA LOUISE 2 LLC)
  3. Owens Senior Housing — 1626 Davis Pl, North Las Vegas, NV 89030 — APN 13922810039 (OWENS 2 LP)
  4. Yale Keyes Senior Apts — 1705 Yale St, North Las Vegas, NV 89030 — APN 13922810051 (YALE KEYES LP)

For each premise/meter, please confirm:
  - Serving transformer rating (kVA) and configuration (pad-mount / pole / vault)
  - Service voltage and phase
  - Number of meters/services on the parcel
  - Any spare capacity or recent service-upgrade history on record

[Owner authorization: I, [name], as [title] for [owner entity], authorize NV Energy to release the
above facility information to [requestor].]
```

---

## Stage 4 — Evidence table (fill as Stages 2–3 return)

All 17 rows owner-verified 2026-06-03 (Assessor `parceldetail.aspx?hdnParcel=<APN>`). **Transformer = Unknown
for every row** (hard rule — no record states kVA; NV Energy not yet queried). "Proposed service assumption"
is the Stack's **generic** 180 kW-firm / 250 kW-inverter site target, *not* a per-building figure.

| Property | Address | APN | Proposed | Evidence (Assessor owner-verified) | Source | Inferred? | Confidence | Gaps / follow-up |
|----------|---------|-----|----------|-----------------------------------|--------|-----------|------------|------------------|
| Aldene Kline Barlow | 1327 H St UT 1, LV 89106 | 13928503028 | ⚠️ generic | CDPC NL LLC · 39u · 34.150 hi-rise · blt 2013 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req (campus = 3 parcels — confirm meter topology) |
| Ethel Mae Robinson | 1327 H St UT 2, LV 89106 | 13928503027 | ⚠️ generic | CDPC NL LLC · 82u · 34.150 hi-rise · 2.80 ac · blt 2009 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| Sarann Knight | 1327 H St UT 3, LV 89106 | 13928503026 | ⚠️ generic | CDPC NL LLC · 38u · 33.150 lo-rise · blt 2011 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| David J. Hoggard Family | 1100 W Monroe Ave, LV 89106 | 13928503022 | ⚠️ generic | SOUTHERN NV HOUSING AUTHORITY · 100u · 33.150 · 5.78 ac · blt 2005 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| Donna Louise 1 | 6225 Donna St, NLV 89081 | 12426103004 | ⚠️ generic | DONNALOUISE LLC · 48u · 33.150 · 2.07 ac · blt 2017 · **permits: BD145340 Multi-Family-New (09/28/2016) + elec BD150889 & BD153590 Commercial (issued 2016/2017)** | parceldetail + NLV EnerGov | — | Parcel: **Confirmed (owner-verified)** · Service size: **Unknown (portal-gated — finding 8)** · Transformer: **Unknown** | Permitted commercial elec service confirmed; amps/voltage/kVA **gated** on public portal → NV Energy req or GPMG EnerGov contact-login. Separate service from Donna 2 |
| Donna Louise 2 | 6275 Donna St, NLV 89081 | 12426103002 | ⚠️ generic | DONNA LOUISE 2 LLC · 48u · 33.150 · blt 2025 · **permits: BD145341 Multi-Family-New + elec BD150892 Commercial (filed 2016, status "Submitted" — Assessor blt 2025, so 2016 filing likely lapsed/rebuilt); fire-alarm BUILD-003041-2025** | parceldetail + NLV EnerGov | — | Parcel: **Confirmed (owner-verified)** · Service size: **Unknown (portal-gated — finding 8)** · Transformer: **Unknown** | Permitted commercial elec service confirmed; size **gated** → NV Energy req or GPMG contact-login. Separate SPE/service from Donna 1 |
| Luther Mack, Jr. Senior | 8158 Giles St, Enterprise 89123 | 17716101027 | ⚠️ generic | MIXED INCOME LLC · 48u · 33.150 · 2.25 ac · blt 2014 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **Unincorp. Clark Co.** (Accela `CLARKCO`) permit dig; NV Energy req |
| Dr. Paul Meacham Senior | 65 E Windmill Ln, Enterprise 89123 | 17716101026 | ⚠️ generic | MIXED INCOME 2 LLC · 57u · 33.150 · 1.93 ac · blt 2014 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **Unincorp. Clark Co.** (Accela `CLARKCO`) permit dig; NV Energy req |
| Ethel Mae Fletcher | 1503 Laurelhurst Dr, LV 89108 | 13825504001 ⚠ | ⚠️ generic | VGAS 1 DCATUR LLC · 18u · 33.150 · 1.32 ac · blt 2016 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | ⚠ Confirm GPMG building = 1503 (18u) vs adjacent 1403/`…504002` (42u); **City of LV** permit dig; NV Energy req |
| Mike O'Callaghan Legacy | 1502 Laurelhurst Dr, LV 89108 | 13825518004 ⚠ | ⚠️ generic | 1501 LLC · 40u · 34.150 hi-rise · 2.22 ac · blt 2025 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | ⚠ Operating bldg = `…518004`; adjacent `…518005` (CDPC) is VACANT land. **City of LV** permit dig; NV Energy req |
| Juan Garcia Garden | 2851 Sunrise Ave, LV 89101 | 13936402015 | ⚠️ generic | ERNIE CRAGIN LP · 52u · 33.150 · 2.94 ac · blt 2002 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| Louise Shell Senior | 2101 N MLK Blvd, LV 89106 | 13921202007 | ⚠️ generic | LSHP LP · 100u · 33.150 · 6.16 ac · blt 2003 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| Owens Senior Housing | 1626 Davis Pl, NLV 89030 | 13922810039 | ⚠️ generic | OWENS 2 LP · 72u · 33.150 · 3.89 ac · blt 2001 · **permits: BD96712 Building-Commercial-New (09/17/2008) + BD11669 Commercial-Addition (2001); extensive fire/commercial history 2001→2026** | parceldetail + NLV EnerGov | — | Parcel: **Confirmed (owner-verified)** · Service size: **Unknown (portal-gated — finding 8)** · Transformer: **Unknown** | Permitted service confirmed; **2001 + 2008 structures → possibly multiple services/meters, confirm count**; size **gated** → NV Energy req or GPMG contact-login |
| Senator Harry Reid Senior | 334 N 11th St (mail 328), LV 89101 | 13935201001 | ⚠️ generic | 11TH STREET LP · 100u · 33.150 · 2.58 ac · blt 2004 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| Senator Richard Bryan Senior | 2651 Searles Ave, LV 89101 | 13925101022 | ⚠️ generic | SOUTHERN NV HOUSING AUTHORITY · 165u · 33.150 · 6.08 ac · blt 2007 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy req |
| Smith Williams Senior | 575 E Lake Mead Pkwy, Henderson 89015 | 17908301011 ⚠ | ⚠️ generic | CHURCH COMMUNITY BAPTIST · 80u · 33.150 · 4.98 ac · blt 2011 | parceldetail | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | ⚠ Fee owner = church (likely ground lease); confirm service-account holder. Henderson runs the **same Tyler EnerGov** as NLV → expect service size **gated** (finding 8); NV Energy req |
| Yale Keyes Senior | 1705 Yale St, NLV 89030 | 13922810051 | ⚠️ generic | YALE KEYES LP · 70u · 33.150 · 6.89 ac · blt 2003 · **permits: BD22311 Multi-Family-New (12/04/2002); ⚠ DRY-010255-2020 "Dry Utility — NV Energy" (plan-approval EXPIRED) + OCP street/dry-utility 2020** | parceldetail + NLV EnerGov | — | Parcel: **Confirmed (owner-verified)** · Service size: **Unknown (portal-gated — finding 8)** · Transformer: **Unknown** | Permitted service confirmed; **2020 NV Energy dry-utility permit (expired) = a lapsed utility project — ask NV Energy what it was**; size **gated** → NV Energy req or GPMG contact-login |

### Confidence rubric
- **Confirmed** — record states transformer kVA, *or* NV Energy confirms. **Only here.**
- **Likely** — service amperage/voltage/switchgear documented, transformer *inferred*. `Inferred? = YES`, always.
- **Unknown** — no electrical record found; assumption ungrounded.

---

## Findings that reshape the task

1. **No per-building electrical assumptions exist yet.** The Stack's "180 kW firm / 250 kW inverter" is a
   *generic site design target*, not derived from any building's real service. This run **grounds the generic
   target against reality** for the first time — it is not validating pre-existing per-building numbers.
2. **No APN/parcel data existed in the repo** — Stage 1 created it (table above).
3. **Only NV Energy can confirm transformer size.** Public records get you to "Likely" at best. The honest
   end-state for most rows will be **"Likely + NV Energy request pending"** until Stage 3 returns.
4. **Roster does NOT collapse — 17 buildings = 17 distinct parcels.** The earlier "Donna 1 & 2 = one parcel"
   and "1327 H St 3 buildings = one APN" collapses were **both artifacts of wrong first-pass APNs** and are
   reversed: Donna 1 (`…103004`) and Donna 2 (`…103002`) are separate SPEs built 8 years apart; the H St campus
   is 3 separate parcels (UT 1/2/3, all CDPC NL LLC). Expect **roughly one service per building**, not fewer.
5. **First-pass point-query was wrong for 9 of 14 parcels.** A single point-in-polygon hit landed on adjacent
   slivers / common-area / stale "X99" master parcels with no assessment record. **Owner-verification against
   the Assessor detail page is mandatory** and is now done for all 17 — this is the most important methodological
   finding of the run.
6. **Stage 2 spans 4 permit jurisdictions** — **10 City of Las Vegas, 4 NLV EnerGov, 2 unincorporated Clark
   County (Accela), 1 Henderson** EnerGov. All SOP'd in the portfolio worksheet (now re-keyed to the
   corrected APNs).
7. **Two parcels need a GPMG ownership confirmation** before NV Energy authorization — Fletcher (1503 `…504001`
   18u vs adjacent 1403 `…504002` 42u, same owner) and O'Callaghan (built bldg `…518004` "1501 LLC" vs adjacent
   CDPC **vacant** lot `…518005`). And Smith Williams' fee owner is a **church** (likely ground lease).
8. **🔑 The Tyler EnerGov public portal GATES service detail — the public permit dig cannot return service size**
   (verified 2026-06-03 on NLV, parcel Donna Louise 1, permit BD150889 Electrical-Commercial). On the SelfService
   portal, the **Summary** tab is public (permit #, type, status, applied/issue dates, valuation) but **every
   service-bearing tab — More Info (custom fields), Fees, Inspections, Sub-Records, Attachments — returns
   *"You must be a contact on this record to see this information."*** Reviews returns *"not available."* So for
   the **4 NLV parcels + 1 Henderson** (same Tyler system = 5 of 17), the public portal proves a **permitted
   commercial electrical service exists and its era**, but **amps / voltage / switchgear / kVA are not publicly
   retrievable**. Two paths remain: **(a)** GPMG logs into EnerGov as the **record contact/applicant** (GPMG *is*
   a contact on its own permits) → unlocks More Info + the approved electrical plan set in Attachments; **(b)** NV
   Energy (the only path to kVA regardless). The "open the permit and read the amperage" step in the worksheet is
   **closed on the public portal** for these 5 — re-routed to (a)/(b). City of LV (10, proprietary portal) and
   unincorporated Clark County (2, Accela) are **different systems and may expose more** — still to test.

## Next actions
- [x] ✅ **Owner-verified all 17 parcels** via the Assessor detail page (2026-06-03): owner-of-record, situs, use, units, year built. **9 of 14 first-pass APNs were wrong** → corrected (see master table + correction note). Reversed both "collapse" assumptions (Donna = 2 parcels; H St = 3 parcels) → **17 buildings = 17 parcels**. Satisfies the owner-of-record prerequisite for the NV Energy requests.
- [x] ✅ Stage 2 prerequisite: AHJ resolved for every parcel (centroid vs. county `Cities` layer) — **10 City of Las Vegas, 4 NLV, 2 unincorporated Clark County (Luther Mack, Meacham / Enterprise), 1 Henderson.**
- [x] ✅ **Re-keyed both sibling files to the corrected APNs** (2026-06-03): [`permit-stage2-worksheet.md`](./permit-stage2-worksheet.md) and [`nv-energy-service-request.md`](./nv-energy-service-request.md) now carry the 17-parcel / owner-verified set — consistent with this master doc.
- [ ] **GPMG to confirm 3 ownership questions** (block-level ambiguity): Fletcher 1503 `…504001` (18u) vs 1403 `…504002` (42u); O'Callaghan built bldg `…518004` (not the adjacent CDPC vacant lot `…518005`); Smith Williams service-account holder vs fee owner CHURCH COMMUNITY BAPTIST (ground lease?).
- [~] Stage 2 permit dig — **NLV (4 parcels) DONE 2026-06-03**: public inventories captured (Donna 1 BD145340 + elec BD150889/BD153590; Donna 2 BD145341 + elec BD150892; Owens BD96712 Commercial-New 2008; Yale BD22311 Multi-Family-New 2002 + a lapsed 2020 NV Energy dry-utility permit). **Finding 8 — service size is portal-gated → these rows stay "service Unknown."** Remaining portals: **City of LV (10, proprietary)**, **unincorp. Clark Co. (2, Accela)**, **Henderson (1, Tyler — expect gated)**. Still confirm meter topology on the H St campus (3 parcels) + 2 Donna parcels (via NV Energy).
- [ ] **NEW lever (NLV + Henderson, finding 8):** GPMG opens its own EnerGov permits **logged in as the record contact/applicant** → unlocks More Info (custom fields) + the approved electrical plan set in Attachments — the only route to NLV/Henderson service size short of NV Energy.
- [ ] Stage 3: send NV Energy facility request (all owners now verified — authorize per owner entity; see Stage 3 owner list).
- [x] ✅ Stage 1 + Stage 2 SOP + Stage 3 request all extended to the full 17-parcel portfolio.
- [x] ✅ Re-validated the **Senator Richard Bryan** APN: sliver `13925297003` → **`13925101022`** (SOUTHERN NV HOUSING AUTHORITY, 6.08 ac, 165 units, blt 2007). 2026-06-03.
