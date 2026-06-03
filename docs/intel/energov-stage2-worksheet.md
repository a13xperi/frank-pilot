# Stage 2 Worksheet — NLV EnerGov Permit Dig (manual)

**For:** an operator or VA running the EnerGov search by hand. ~10 min/parcel.
**Why manual:** the portal is behind **Cloudflare bot-protection + CSRF** (verified 2026-06-03 — all JSON-API
probes return HTTP 403). It cannot be reliably scripted; use a real browser session.

**Portal:** https://eg.cityofnorthlasvegas.com/EnerGov_Prod/SelfService#/search
**Goal:** find any electrical record that states a **service amperage / voltage / switchgear / CT cabinet** —
and ideally **transformer kVA**. Per the hard rule, kVA is the only field that supports "Confirmed"; everything
else is **inferred → "Likely" max**.

---

## Procedure (repeat per parcel)

1. Open the portal → **Search**.
2. Run **two passes** so records filed under either key are caught:
   - Pass A — by **address** (street number + name only, e.g. `6225 Donna`).
   - Pass B — by **parcel / APN** (digits only, no dashes).
3. Set record type to **Permit**; filter to **Electrical**. Then re-scan **Building** permits for
   new-construction / service-upgrade scope (electrical detail often lives on the building permit).
4. For every hit, fill one row in the capture table below.
5. Screenshot each record detail page; save the record URL.

> **Absence ≠ none.** If no permit appears, the record is *silent*, not proof of no service. That row stays
> **Unknown** until NV Energy answers — do not infer "no service."

---

## Search keys (pre-filled)

| Parcel | Pass A — address | Pass B — APN |
|--------|------------------|-------------|
| Donna Louise 1&2 | `6225 Donna` | `12426199007` |
| Owens Senior | `1626 Davis` | `13922810039` |
| Yale Keyes | `1705 Yale` | `13922899006` |

---

## Capture table (fill in)

| Parcel | Permit # / record ID | Status | Issue date | **Service amps** | **Voltage / phase** | Switchgear / CT / meter config | **kVA stated?** | CO/TCO + final elec. inspection | Record URL |
|--------|----------------------|--------|-----------|------------------|---------------------|-------------------------------|-----------------|----------------------------------|-----------|
| Donna Louise 1&2 | | | | | | | ☐ no  ☐ YES → ___ kVA | | |
| Owens Senior | | | | | | | ☐ no  ☐ YES → ___ kVA | | |
| Yale Keyes | | | | | | | ☐ no  ☐ YES → ___ kVA | | |

(Add rows if a parcel has multiple electrical permits. For Owens, note the **meter count** if visible —
baseline assumption is a single service.)

---

## Tagging rule (apply to every captured field)

- **kVA stated outright** → candidate for **Confirmed**; record the value + the record URL as the source.
- **amps / voltage / CT cabinet / switchgear / meter type only** → **inferred → "Likely" max**; set
  `Inferred? = YES` in the Stage-4 evidence table.

## Handoff back
When done, drop the filled capture table into `electrical-service-validation.md` → **Stage 4 — Evidence table**,
and set each row's confidence per the rubric (Confirmed only on stated kVA or NV Energy; else Likely; else Unknown).
