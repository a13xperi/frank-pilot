# GPMG NV — Electrical-Service Validation · Status & Punch List

**What this is.** Field validation of the *existing* electrical service across GPMG's **17-building** NV affordable/senior-housing portfolio. Per building it nails down three things: the **parcel + owner of record** (done), the **permitting authority** (done), and the **existing service size + transformer kVA** (in progress). This is the grounding layer for the on-site solar + battery design under *The Stack* — we can't size a new load until we know what electrical service is already in the ground.

**Last updated:** 2026-06-03 · **Tracking:** [PR #258](https://github.com/a13xperi/frank-pilot/pull/258) · **Detail docs:** this folder (`docs/intel/`)

---

## ⏱️ Bottom line — where we are right now

| Stage | What it proves | Status |
|---|---|---|
| **1 — Parcel + owner** | APN, owner of record, units, AHJ | ✅ **Done** — all 17 owner-verified (2026-06-03) |
| **2 — Permit scrape** | service amps / voltage / switchgear (sometimes kVA) | 🔄 **In progress** ◀ *we are here* |
| **3 — NV Energy** | the actual transformer **kVA** — the only true authority | ⬜ Gated on owner sign-off + requestor |
| **4 — Evidence table** | per-building confidence rollup | ⬜ Fills in as Stages 2–3 return |

**Headline:** 17 buildings = **17 owner-verified parcels**, ~**1,157 units**, across **4 permitting authorities**. Parcel, owner, and jurisdiction are confirmed for every building. **Every transformer kVA is still Unknown** — closing that is the entire point of Phases 2–3.

> ⚠️ **The hard rule — sets expectations for everyone reading this.** No transformer rating is marked **"Confirmed"** unless a record states the kVA outright **or** NV Energy confirms it. Anything inferred from amperage/voltage is **"Likely" at best**. We do not over-claim: if a number isn't sourced, it stays **Unknown**.

---

## 🏢 The portfolio — 17 parcels by permitting authority

| # | Building | Address (ZIP) | APN | Owner of record | Units | AHJ |
|---|----------|---------------|-----|-----------------|-------|-----|
| 1 | Donna Louise 1 | 6225 Donna St (89081) | `12426103004` | DONNALOUISE LLC | 48 | North Las Vegas |
| 2 | Donna Louise 2 | 6275 Donna St (89081) | `12426103002` | DONNA LOUISE 2 LLC | 48 | North Las Vegas |
| 3 | Owens Senior Housing | 1626 Davis Pl (89030) | `13922810039` | OWENS 2 LP | 72 | North Las Vegas |
| 4 | Yale Keyes Senior | 1705 Yale St (89030) | `13922810051` | YALE KEYES LP | 70 | North Las Vegas |
| 5 | Aldene Kline Barlow (1327 H St UT 1) | 1327 H St (89106) | `13928503028` | CDPC NL LLC | 39 | City of Las Vegas |
| 6 | Ethel Mae Robinson (1327 H St UT 2) | 1327 H St (89106) | `13928503027` | CDPC NL LLC | 82 | City of Las Vegas |
| 7 | Sarann Knight (1327 H St UT 3) | 1327 H St (89106) | `13928503026` | CDPC NL LLC | 38 | City of Las Vegas |
| 8 | David J. Hoggard Family | 1100 W Monroe Ave (89106) | `13928503022` | SOUTHERN NV HOUSING AUTHORITY | 100 | City of Las Vegas |
| 9 | Ethel Mae Fletcher ⚠ | 1503 Laurelhurst Dr (89108) | `13825504001` | VGAS 1 DCATUR LLC | 18 | City of Las Vegas |
| 10 | Mike O'Callaghan Legacy ⚠ | 1502 Laurelhurst Dr (89108) | `13825518004` | 1501 LLC | 40 | City of Las Vegas |
| 11 | Juan Garcia Garden | 2851 Sunrise Ave (89101) | `13936402015` | ERNIE CRAGIN LP | 52 | City of Las Vegas |
| 12 | Louise Shell Senior | 2101 N MLK Blvd (89106) | `13921202007` | LSHP LP | 100 | City of Las Vegas |
| 13 | Senator Harry Reid Senior | 334 N 11th St (89101) | `13935201001` | 11TH STREET LP | 100 | City of Las Vegas |
| 14 | Senator Richard Bryan Senior | 2651 Searles Ave (89101) | `13925101022` | SOUTHERN NV HOUSING AUTHORITY | 165 | City of Las Vegas |
| 15 | Luther Mack, Jr. Senior | 8158 Giles St (89123) | `17716101027` | MIXED INCOME LLC | 48 | Unincorp. Clark Co. |
| 16 | Dr. Paul Meacham Senior | 65 E Windmill Ln (89123) | `17716101026` | MIXED INCOME 2 LLC | 57 | Unincorp. Clark Co. |
| 17 | Smith Williams Senior ⚠ | 575 E Lake Mead Pkwy (89015) | `17908301011` | CHURCH COMMUNITY BAPTIST (fee) | 80 | Henderson |

**AHJ split:** North Las Vegas ×4 · City of Las Vegas ×10 · Unincorporated Clark County ×2 · Henderson ×1 = **17**.
17 parcels resolve to **14 owning entities** (CDPC NL LLC owns 3, Southern NV Housing Authority owns 2).

> ⚠️ **3 parcels carry an ownership caveat** (affect *who signs* the NV Energy request, not the scrape): **Fletcher**, **O'Callaghan**, **Smith Williams** — details in the punch list below.

---

# ✅ THE PUNCH LIST

## Phase 2 — Permit scrape ◀ in progress (this is the active work)

**Per parcel:** open the portal → **Search → Permits** → run **two passes** (by **address**, then by **APN**) → filter to **Electrical** *and* scan **Building** permits (service detail often hides there) → **screenshot every hit + save the record URL**.

**What we're hunting (in priority order):** ① **transformer kVA stated** (the jackpot — only field that earns "Confirmed") → ② service **amperage** → ③ **voltage / phase** → ④ switchgear / CT cabinet / meter config → ⑤ CO/TCO + final electrical inspection. *Absence of a permit ≠ no service — that parcel just stays Unknown until NV Energy answers.*

Work one portal at a time (open it once, clear all its parcels):

### ☐ North Las Vegas — Tyler EnerGov *(manual; Cloudflare/CSRF blocks scripts — use a real browser)*
Portal: `https://eg.cityofnorthlasvegas.com/EnerGov_Prod/SelfService#/search`
- [ ] Donna Louise 1 — `6225 Donna` / APN `12426103004`
- [ ] Donna Louise 2 — `6275 Donna` / APN `12426103002`
- [ ] Owens Senior — `1626 Davis` / APN `13922810039`
- [ ] Yale Keyes — `1705 Yale` / APN `13922810051`

### ☐ City of Las Vegas — CLV permit status / Dashboard *(manual)*
Portal: `https://www.lasvegasnevada.gov/Business/Permits-Licenses/Building-Permits/Permit-Application-Status`
- [ ] Aldene Kline Barlow (UT 1) — `1327 H St` / APN `13928503028`
- [ ] Ethel Mae Robinson (UT 2) — `1327 H St` / APN `13928503027`
- [ ] Sarann Knight (UT 3) — `1327 H St` / APN `13928503026`
- [ ] David J. Hoggard Family — `1100 W Monroe` / APN `13928503022`
- [ ] Ethel Mae Fletcher ⚠ — `1503 Laurelhurst` / APN `13825504001`
- [ ] Mike O'Callaghan Legacy ⚠ — `1502 Laurelhurst` / APN `13825518004`
- [ ] Juan Garcia Garden — `2851 Sunrise` / APN `13936402015`
- [ ] Louise Shell Senior — `2101 N MLK` / APN `13921202007`
- [ ] Senator Harry Reid Senior — `334 N 11th` (mail 328) / APN `13935201001`
- [ ] Senator Richard Bryan Senior — `2651 Searles` / APN `13925101022`

### ☐ Unincorporated Clark County — Accela Citizen Access *(manual)*
Portal: `https://aca-prod.accela.com/CLARKCO/Cap/CapHome.aspx?module=Building`
*(Both carry a "Las Vegas" mailing address but sit in Enterprise township → the **County**, not the City, is the AHJ.)*
- [ ] Luther Mack, Jr. Senior — `8158 Giles` / APN `17716101027`
- [ ] Dr. Paul Meacham Senior — `65 E Windmill` / APN `17716101026`

### ☐ Henderson — Tyler EnerGov (DSC Online) *(manual; likely Cloudflare/CSRF like NLV)*
Portal: `https://dsconline.cityofhenderson.com/energov_prod/selfservice#/home`
- [ ] Smith Williams Senior ⚠ — `575 E Lake Mead` / APN `17908301011`

### ☐ Two meter-topology checks (do while scraping)
- [ ] **1327 H St campus** (parcels 5/6/7) — one shared service or three separate? A permit showing the meter/service split settles it. *Do not assume shared — the earlier "one parcel" reading was wrong.*
- [ ] **Donna Louise 1 & 2** (parcels 1/2) — separate services or shared? Same check.

### ☐ Log it
- [ ] Drop every captured field into the **Stage 4 — Evidence table** in `electrical-service-validation.md`.
- [ ] Tag each row: **kVA stated → "Confirmed"** (+ record URL as source); **amps/voltage only → "Likely"** with `Inferred? = YES`; **nothing found → "Unknown."**

> 📋 Full capture grid (amps / voltage / switchgear / kVA / CO-TCO / URL columns) is pre-built in **`permit-stage2-worksheet.md`** — use that as the scrape worksheet.

---

## Phase 3 — NV Energy request *(the critical path; gated on the items below)*

NV Energy transformer kVA is in **no** public record — this request is the **only** path to a "Confirmed" rating. The send-ready letter + per-owner authorization block is drafted in **`nv-energy-service-request.md`**. Before it can go out:

- [ ] **Name the requestor** — who at GPMG is making the ask (name / title / email / phone)
- [ ] **Resolve the 3 ownership caveats** (so the right entity signs):
  - [ ] **Fletcher** — confirm GPMG's building is **1503** (`…504001`, 18u) vs the same-owner **1403** (`…504002`, 42u)
  - [ ] **O'Callaghan** — confirm operating bldg `…518004` (not the adjacent CDPC **vacant** lot `…518005`)
  - [ ] **Smith Williams** — fee owner is a church (likely a GPMG ground lease); confirm **who holds the meter/account** before authorizing
- [ ] **Collect authorized-agent signature(s)** — one combined signature if a single GPMG agent is authorized across all **14 owning entities**, else one per entity
- [ ] **Send** via NV Energy Builder/Developer Services (`https://www.nvenergy.com/cleanenergy/builders-developers`) or your service-planning contact
- [ ] Log the send date; set each Stage-4 row to **"Likely + NV Energy pending"** until reply

## Phase 4 — Evidence rollup *(auto-follows)*
- [ ] As Stages 2–3 return, transcribe kVA / voltage / meter count per premise into the Stage-4 table
- [ ] Only rows with a **stated kVA or an NV Energy answer** graduate to **Confirmed**

---

## 📁 The documents (what's in this folder)

| File | Purpose | For |
|------|---------|-----|
| **`README.md`** (this file) | Status + punch list — the front door | Everyone |
| **`electrical-service-validation.md`** | Master roadmap — sources, Stages 1–4, evidence table, confidence rubric | Reference |
| **`permit-stage2-worksheet.md`** | Scrape worksheet — portals + capture grid, pre-keyed by AHJ | Phase 2 operator |
| **`nv-energy-service-request.md`** | Send-ready NV Energy letter + 14-entity authorization block | Phase 3 |

A live review synthesis of all of the above is mirrored in Notion: *⚡ GPMG NV — Electrical-Service Validation (17 bldgs → 17 parcels)*.

---

## 🔎 How the parcels were verified (provenance, in one paragraph)

Each address was geocoded (Clark County composite locator), point-in-polygon'd against the Assessor parcel layer, and the resulting APN **confirmed on the Assessor detail page** by matching situs + owner + use + unit count. The first-pass single-point pull was **wrong for 9 of the original 14 parcels** (it hit adjacent slivers / stale "X99" master parcels with no assessment record) — the owner-of-record is the authoritative tiebreak. AHJ was resolved by testing each parcel's area-weighted **centroid** against the county `Cities` boundary layer (a `CC ` prefix = unincorporated → County is the AHJ), validated against the 5 parcels with already-known authorities.

> *AI-assisted field intel. Verify against primary sources (Assessor, permit portals, NV Energy) before relying on any line for a legal or utility filing.*
