# Electrical Service Validation — GPMG North Las Vegas

**Created:** 2026-06-03
**Goal:** Cross-validate proposed electrical service assumptions per building and identify the
authoritative source needed to confirm transformer size.
**Scope:** Primary deep-dive = 4 North Las Vegas GPMG properties (3 parcels) — Stages 2–4 below.
**Stage 1 (APN) now extended live to all 17 GPMG buildings → 14 parcels across 3 permit jurisdictions**
(see "Stage 1 (extended)").

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

## Stage 1 — Normalize + APN  ✅ DONE (scripted, live)

Single coordinate per address → point-in-polygon against the Assessor Parcels layer.

| Property | Address | ZIP | APN | Parcel | Tax dist | Units |
|----------|---------|-----|-----|--------|----------|-------|
| Donna Louise Apartments **(1 & 2)** | 6225 Donna St | 89081 | **12426199007** | 1.28 ac (~55,429 ft²) | 254 | 48 + 48 |
| Owens Senior Housing | 1626 Davis Pl | 89030 | **13922810039** | ~3.9 ac (~169,361 ft²) | 253 | 72 |
| Yale Keyes Senior Apartments | 1705 Yale St | 89030 | **13922899006** | 8.52 ac (~371,296 ft²) | 253 | 70 |

> 🔑 **Donna Louise 1 & 2 resolve to ONE parcel / one APN** → treat as a single electrical service unless
> EnerGov/NV Energy shows separate meters. This collapses the roster from 4 buildings to **3 parcels**.
> Owens & Yale Keyes are ~200 m apart in the 89030 Windsor Park pocket but are **distinct parcels**.

**Confidence on parcel data: Confirmed.** (Assessor is authoritative for APN/parcel — not for electrical.)

### Re-validation 2026-06-03 (live ArcGIS query, `where=APN='…'`)
All three APNs return **exactly 1 feature**. Two caveats surfaced:

| APN | `ASSR_ACRES` | `Shape.area` (ft²) | Note |
|-----|--------------|--------------------|------|
| 12426199007 (Donna) | 1.28 | 55,429 | assessor + geometry agree ✓ |
| 13922810039 (Owens) | **0.0** | 169,361 (≈3.9 ac) | acreage field **unpopulated** → the "~3.9 ac" figure is **geometry-derived** (`Shape.area`), not assessor |
| 13922899006 (Yale)  | 8.52 | 371,296 | assessor + geometry agree ✓ |

> **Owens `ASSR_ACRES=0` — calibrated, low concern.** Neighbor geometries are a *mix* of lot sizes
> (`…037` 0.22 ac, `…038` 0.19 ac, `…039` **3.9 ac**, `…040` 1.76 ac, `…051` 6.91 ac, `…053` 5.81 ac), i.e.
> a normal platted block, **not** a uniform condo-airspace plat (which would be many identical tiny units).
> `…039` is a single coherent 3.9-ac parcel. The zero-acre flag tracks **tax-exempt / newer** parcels
> (`…037`–`…040` all 0; older `…051/…053` populated) — consistent with Owens being senior/affordable
> (likely tax-exempt) housing, not a missing or fragmented parcel. **Single-service assumption stands**;
> still confirm the meter count at Stage 2, but treat one-APN-one-service as the baseline.

### Stage 1 (extended) — all 17 GPMG buildings → 14 parcels, 3 jurisdictions  ✅ DONE (live, 2026-06-03)

Full-portfolio point-in-polygon pull (same Assessor Parcels endpoint). **The 11 non-NLV parcel-rows are
first-pass (single point query) and have NOT had the `where=APN='…'` second-pass re-validation the 3 NLV
parcels got** — treat acreage as indicative; re-verify the one flagged anomaly before relying on it.

| APN | Building(s) on parcel | Address | ZIP | Jurisdiction | `ASSR_ACRES` |
|-----|----------------------|---------|-----|--------------|--------------|
| **13928599064** | Aldene Kline Barlow **+** Ethel Mae Robinson **+** Sarann Knight | 1327 H St | 89106 | Las Vegas | 0.63 |
| 13928599052 | David J. Hoggard Family | 1100 W Monroe Ave | 89106 | Las Vegas | 0.35 |
| **12426199007** | Donna Louise **1 & 2** | 6225 Donna St | 89081 | **North Las Vegas** | 1.28 |
| 17716101027 | Luther Mack, Jr. Senior | 8158 Giles St | 89123 | Las Vegas | 2.25 |
| 17716199002 | Dr. Paul Meacham Senior | 65 E Windmill Ln | 89123 | Las Vegas | 0.57 |
| 13825504002 | Ethel Mae Fletcher | 1503 Laurelhurst Dr | 89108 | Las Vegas | 2.07 |
| 13825599014 | Mike O'Callaghan Legacy | 1502 Laurelhurst Dr | 89108 | Las Vegas | 0.33 |
| 13936402015 | Juan Garcia Garden | 2851 Sunrise Ave | 89101 | Las Vegas | 2.94 |
| 13921699052 | Louise Shell Senior | 2101 N MLK Blvd | 89106 | Las Vegas | 4.08 |
| 13922810039 | Owens Senior Housing | 1626 Davis Pl | 89030 | **North Las Vegas** | 0.0 † |
| 13935201001 | Senator Harry Reid Senior | 328 N 11th St | 89101 | Las Vegas | 2.58 |
| 13925101022 | Senator Richard Bryan Senior | 2651 Searles Ave | 89101 | Las Vegas | 6.08 ✅ |
| 17908399001 | Smith Williams Senior | 575 E Lake Mead Pkwy | 89015 | **Henderson** | 14.54 |
| **13922899006** | Yale Keyes Senior | 1705 Yale St | 89030 | **North Las Vegas** | 8.52 |

† Owens `0.0` = tax-exempt acreage field (3.9 ac by geometry) — see calibration above, **not** fragmentation.

**17 buildings → 14 distinct parcels**, because two parcels each carry multiple buildings:
- **1327 H St campus** = **3 buildings on one APN** `13928599064` (Aldene Kline Barlow / Ethel Mae Robinson /
  Sarann Knight) → likely **one shared service** for the campus. New find — same collapse pattern as Donna 1 & 2.
- **Donna Louise 1 & 2** = 2 buildings on one APN `12426199007`.

**Stage 2 permit dig splits across 4 AHJs — all SOP'd, and the AHJ of every parcel is now resolved:**

| AHJ | Parcels | Stage 2 portal |
|-----|---------|----------------|
| North Las Vegas | 3 (Donna, Owens, Yale) | NLV EnerGov (Tyler) — Cloudflare/CSRF, manual ✅ |
| **City of Las Vegas** | **8** | CLV Dashboard / permit status — manual ✅ |
| **Unincorporated Clark County** | **2** (Luther Mack, Dr. Paul Meacham — Enterprise twp) | Clark Co. Accela `CLARKCO` — manual ✅ |
| Henderson | 1 (Smith Williams) | Henderson EnerGov (DSC Online, Tyler) — manual ✅ |

> ✅ **AHJ trap RESOLVED (2026-06-03).** The 10 "Las Vegas"-mailing parcels were split by point-in-polygon
> (parcel centroid vs. county `Cities` boundary layer): **8 are City of Las Vegas, 2 are unincorporated Clark
> County** — Luther Mack (`17716101027`) and Dr. Paul Meacham (`17716199002`), both in the Enterprise township
> (89123). Method validated against the 4 known parcels (3 NLV + 1 Henderson, all matched). Per-parcel filing in
> [`permit-stage2-worksheet.md`](./permit-stage2-worksheet.md) §A–§D; provenance in its appendix.

> ✅ **Anomaly RESOLVED (2026-06-03):** the first-pass **Senator Richard Bryan** hit `13925297003` was a
> **0.015 ac (~640 ft²) sliver** — confirmed wrong. Re-validated via three independent geocoders + the
> **Clark County Assessor real property record**, which is authoritative: **APN `13925101022`**, owner
> **SOUTHERN NV HOUSING AUTHORITY** (c/o C Rowe), situs **2651 Searles Ave**, **6.08 ac**, use **33.150 low-rise
> apartments (1–3 story, 5+ units)**, **165 dwelling units**, **built 2007**. The Census TIGER geocoder mis-pointed
> to an adjacent 0.67-ac frontage parcel (`13925199028`); the county's own geocoder + owner record settled it.
> Source: `maps.clarkcountynv.gov/assessor/AssessorParcelDetail/parceldetail.aspx?hdnParcel=13925101022`.

---

## Stage 2 — Permit dig (3 AHJs, portfolio) — MANUAL CHECKLIST

> 📄 **Operator worksheet:** [`permit-stage2-worksheet.md`](./permit-stage2-worksheet.md) — all **14 parcels**
> split by AHJ (NLV / City of LV / unincorporated Clark County / Henderson), pre-filled search keys + capture
> table, ~10 min/parcel. Portal map verified 2026-06-03. Both EnerGov portals (NLV + Henderson) sit behind
> Cloudflare + CSRF (JSON probes → HTTP 403) → not scriptable, use a real browser.

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
> version, all 14 parcels** pre-filled (one utility serves all). The **3 NLV parcels are send-ready** (owner =
> **Donna Louise LLC**, confirmed); the other 11 parcels need their owner-of-record entity confirmed before
> authorization. Complete the bracketed requestor identity + signature(s), then send.

Draft below (mirrored in the send-ready file) — fill the bracketed fields, send from (or CC) the property
owner/authorized agent so NV Energy will release facility data.

```
To: NV Energy — Service Planning / Builder Services
From: [Owner / authorized agent name, GPMG], [email], [phone]
Re: Existing electrical service & transformer confirmation — 3 parcels, North Las Vegas

We are validating the existing electrical service for three GPMG-owned multifamily properties and
request the existing service size and transformer rating (kVA) of record for each:

  1. Donna Louise Apartments — 6225 Donna St, North Las Vegas, NV 89081 — APN 12426199007
  2. Owens Senior Housing    — 1626 Davis Pl, North Las Vegas, NV 89030 — APN 13922810039
  3. Yale Keyes Senior Apts   — 1705 Yale St,  North Las Vegas, NV 89030 — APN 13922899006

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

| Property | Address | APN | Proposed service assumption | Evidence found | Source URL / record ID | Inferred? | Confidence | Gaps / follow-up |
|----------|---------|-----|-----------------------------|----------------|------------------------|-----------|------------|------------------|
| Donna Louise (1&2) | 6225 Donna St, NLV 89081 | 12426199007 | ⚠️ generic (see note) | _(Assessor parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | Run EnerGov; send NV Energy request |
| Owens Senior Housing | 1626 Davis Pl, NLV 89030 | 13922810039 | ⚠️ generic | _(Parcel geometry confirmed 3.9 ac; `ASSR_ACRES=0` = tax-exempt field, not fragmentation; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | Run EnerGov (confirm meter count); send NV Energy request |
| Yale Keyes Senior Apts | 1705 Yale St, NLV 89030 | 13922899006 | ⚠️ generic | _(Assessor parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | Run EnerGov; send NV Energy request |
| Aldene Kline Barlow / E.M. Robinson / Sarann Knight (3 bldgs) | 1327 H St, LV 89106 | 13928599064 | ⚠️ generic | _(Stage-1 parcel confirmed; 3 bldgs / 1 APN — likely shared service; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig (confirm meter count); NV Energy request |
| David J. Hoggard Family | 1100 W Monroe Ave, LV 89106 | 13928599052 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Luther Mack, Jr. Senior | 8158 Giles St, LV 89123 | 17716101027 | ⚠️ generic | _(Stage-1 parcel confirmed; AHJ = **unincorp. Clark Co.**, Enterprise twp; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **Unincorp. Clark Co.** (Accela `CLARKCO`) permit dig; NV Energy request |
| Dr. Paul Meacham Senior | 65 E Windmill Ln, LV 89123 | 17716199002 | ⚠️ generic | _(Stage-1 parcel confirmed; AHJ = **unincorp. Clark Co.**, Enterprise twp; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **Unincorp. Clark Co.** (Accela `CLARKCO`) permit dig; NV Energy request |
| Ethel Mae Fletcher | 1503 Laurelhurst Dr, LV 89108 | 13825504002 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Mike O'Callaghan Legacy | 1502 Laurelhurst Dr, LV 89108 | 13825599014 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Juan Garcia Garden | 2851 Sunrise Ave, LV 89101 | 13936402015 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Louise Shell Senior | 2101 N MLK Blvd, LV 89106 | 13921699052 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Senator Harry Reid Senior | 328 N 11th St, LV 89101 | 13935201001 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Senator Richard Bryan Senior | 2651 Searles Ave, LV 89101 | 13925101022 ✅ | ⚠️ generic | _(**Assessor-verified**: owner SOUTHERN NV HOUSING AUTHORITY, 6.08 ac, use 33.150 low-rise apts, 165 units, blt 2007; electrical TBD)_ | Assessor `parceldetail.aspx?hdnParcel=13925101022` | — | Parcel: **Confirmed (owner-verified)** · Transformer: **Unknown** | **City of LV** permit dig; NV Energy request |
| Smith Williams Senior | 575 E Lake Mead Pkwy, Henderson 89015 | 17908399001 | ⚠️ generic | _(Stage-1 parcel confirmed; electrical TBD)_ | ArcGIS Parcels/1 | — | Parcel: Confirmed · Transformer: **Unknown** | Henderson EnerGov permit dig; NV Energy request |

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
4. **Roster collapses on shared parcels.** NLV: Donna Louise 1 & 2 → one APN `12426199007` (4 bldgs → 3
   parcels). Portfolio-wide: also the **1327 H St campus = 3 buildings on one APN** `13928599064` →
   **17 buildings collapse to 14 parcels**. Fewer distinct electrical services than buildings.
5. **Stage 2 spans 3+ permit jurisdictions** — NLV EnerGov, **City of Las Vegas / unincorporated Clark County**
   (the 10 "Las Vegas" parcels split by AHJ), and **Henderson** EnerGov. All now SOP'd in the portfolio
   worksheet; the remaining manual step per "Las Vegas" parcel is the City-of-LV-vs-Clark-County determination.

## Next actions
- [ ] Stage 2: permit dig for all **14 parcels** (manual) per [`permit-stage2-worksheet.md`](./permit-stage2-worksheet.md) → fill evidence table. (Confirm meter count on the multi-building parcels — Owens single-service baseline; Donna Louise ×2; 1327 H St ×3.)
- [x] ✅ Stage 2 prerequisite: AHJ resolved for all 10 "Las Vegas" parcels by point-in-polygon (centroid vs. county `Cities` layer) — **8 City of Las Vegas, 2 unincorporated Clark County** (Luther Mack, Dr. Paul Meacham / Enterprise twp). Filed per-AHJ in the worksheet §A–§D.
- [ ] Stage 3: send NV Energy facility request per [`nv-energy-service-request.md`](./nv-energy-service-request.md). **3 NLV parcels send-ready (Donna Louise LLC ✅);** confirm owner-of-record entity for the other 11 parcels before authorizing.
- [x] ✅ Stage 1 APN extended to all 17 GPMG buildings (→ 14 parcels; see "Stage 1 (extended)").
- [x] ✅ Stage 2 SOP extended past NLV — worksheet now covers City of LV / unincorporated Clark County / Henderson.
- [x] ✅ Stage 3 NV Energy request extended to the full 14-parcel portfolio.
- [x] ✅ Re-validated the **Senator Richard Bryan** APN: sliver `13925297003` was wrong → corrected to **`13925101022`** (Assessor owner-verified: SOUTHERN NV HOUSING AUTHORITY, 6.08 ac, 165 units, blt 2007). 2026-06-03.
- [ ] **Owner-verify the other 13 parcels** the same way — the Assessor detail page `parceldetail.aspx?hdnParcel=<APN>` returns owner + situs + use code + unit count + year built, which also satisfies the "confirm owner-of-record entity" prerequisite for the NV Energy requests above. (Bryan done; 13 to go.)
