# The Site Reality Layer — a repeatable infrastructure-validation methodology

**What this is.** A project-agnostic runbook for proving **what electrical/utility infrastructure
is actually in the ground at a site** before any financial, energy, or development stack is welded
onto it. It is the *front-end* every project rides on: you cannot size a new load, claim a credit,
or underwrite an asset until you know — to a stated confidence — what service already exists, who
owns the parcel, and who has authority over it.

It was distilled from the **GPMG North Las Vegas** run (17 buildings → 17 owner-verified parcels
across 4 permitting authorities, 2026-06-03). GPMG is the **worked example** throughout; the method
is the product. Run it on any U.S. site by swapping the three source systems (county assessor GIS,
the AHJ permit portal, the electric utility) for the local equivalents.

> **Read this first — the one principle everything else serves.** Every datum has **exactly one
> authoritative source**. A value obtained from anything weaker than that source is **never
> "Confirmed"** — it is **"Likely" at best, and flagged as inferred**. If a number isn't sourced, it
> stays **Unknown**. This is what keeps a *design assumption* from silently masquerading as a
> *validated fact* — the single failure that quietly poisons an underwriting.

---

## The pipeline at a glance

| Stage | Question it answers | Authoritative source | Scriptable? | Output |
|------:|---------------------|----------------------|:-----------:|--------|
| **1 — Parcel + Owner** | *Where exactly, and who owns it?* | County assessor (GIS + detail page) | ◐ GIS yes, owner-verify manual | APN, owner of record, units, acreage, year built |
| **2 — Jurisdiction (AHJ)** | *Who issues permits here?* | Municipal-boundary GIS layer | ✅ yes | The Authority Having Jurisdiction per parcel |
| **3 — Permit dig** | *What service is documented, and from when?* | The AHJ's permit portal | ⚠️ portal-dependent | Permit inventory + era; **sometimes** service size |
| **4 — Utility** | *What is the actual transformer / service capacity?* | The electric utility | ❌ owner-authorized request | The only **Confirmed** kVA / service number |

The stages are **gated, in order** — Stage *N* needs Stage *N−1*'s output (you can't dig permits
without the right APN; you can't pick the portal without the AHJ; you can't authorize a utility
request without the verified owner). Confidence **monotonically increases** down the stack; the
honest end-state for most rows is **"Likely + utility request pending"** until Stage 4 returns.

---

## Stage 1 — Parcel + Owner

**Goal:** resolve every building to its **true assessed parcel** and **owner of record**.

**Method:** address → county composite geocoder → **GIS point-in-polygon** (parcels layer) → **owner-verify
on the assessor detail page**. The owner-verify step is not optional — see the failure mode below.

**Capture per parcel:** APN · owner of record · situs (assessor's own address) · use code · dwelling
units · acreage · year built.

> ### ⚠️ Failure mode 1 — the single point-query is unreliable (it was wrong for 9 of 14 parcels at GPMG)
> A lone point-in-polygon hit lands on **adjacent slivers, common-area strips, or stale "master"
> parcels with no assessment record**. At GPMG every failing APN shared a block pattern (`…X99…`)
> and returned *"No record found"* from the assessor. **Re-resolve each parcel from its street
> address and confirm against the assessor detail page** — exact situs + owner + use + unit-count
> match is the proof. Treat the first-pass GIS APN as a *candidate*, never an answer.

> ### ⚠️ Failure mode 5 — blank assessor fields are not always "missing data"
> A parcel showing `ACRES = 0` may be a **tax-exempt blanked field**, not a fragmented parcel.
> Calibrate against neighbor lot sizes before concluding anything about the geometry (GPMG: Owens
> read 0 acres but the geometry was a clean 3.9 ac — a tax-exempt blank, not a sliver).

> ### ⚠️ Failure mode 6 — don't let bad data collapse the roster
> Wrong first-pass APNs made two GPMG buildings *look* like one parcel twice over. **Default to
> one service per building** until a record proves sharing. Reversing a false collapse late is
> expensive; assuming separateness and merging later is cheap.

**Confidence:** parcel/owner data is **Confirmed** once owner-verified (the assessor is authoritative
for APN/parcel/owner) — but **never** for electrical/transformer.

---

## Stage 2 — Jurisdiction (AHJ)

**Goal:** determine **which authority issues permits** for each parcel — this picks the Stage 3 portal.

**Method:** take each parcel's **centroid** and run point-in-polygon against the county's
**municipal-boundary ("Cities") layer**. An unincorporated-area tag (often a `CC`/county prefix)
means the **county**, not the mailing city, is the AHJ.

> ### ⚠️ Failure mode 2 — mailing city ≠ permitting authority
> A site with a "Las Vegas" mailing address can sit in an **unincorporated county township** and be
> permitted by the **county**, not the city. At GPMG, two parcels (Luther Mack, Meacham) carried Las
> Vegas mailing addresses but fell in the Enterprise township → **unincorporated Clark County** AHJ.
> These are the traps that send an operator to the wrong portal. Always resolve by geography.

> ### ⚠️ Failure mode 3 — use the centroid, not a polygon-intersect
> A parcel **polygon** that touches a jurisdiction boundary will *intersect two* authorities and
> false-match. A **centroid** lands in exactly one. (GPMG: an intersects query double-matched a
> boundary-edge parcel to two cities; the centroid resolved it cleanly.)

**Validate the method** against any parcels whose AHJ you already know with certainty — if the
centroid test reproduces the knowns, trust it for the unknowns. (GPMG: validated against 3 known
NLV + 1 known Henderson parcel before trusting the rest.)

---

## Stage 3 — Permit dig

**Goal:** pull each parcel's **permit history** from its AHJ portal — establishing that a permitted
commercial service **exists**, its **era**, and (portal permitting) its **size**.

**Portal taxonomy — know which system you're driving before you start:**

| Portal system | Public yield | Driving notes |
|---------------|--------------|---------------|
| **Tyler EnerGov SelfService** | **Summary tab only** (permit #, type, status, dates, valuation) | AngularJS SPA. Cloudflare/CSRF blocks scripts → **drive a real browser**. Set the search model via a native input event + click Search; a hash-param change alone does **not** re-run the query. |
| **Accela Citizen Access** | Usually richer (often itemized) | Test early — it's the decisive read on whether *any* public portal yields service size. |
| **Proprietary city portals** | Varies | Treat as unknown until probed. |

> ### 🔑 Failure mode 4 — the public portal gates the data you actually want
> On **Tyler EnerGov**, the **Summary** tab is public but **every service-bearing tab — More Info
> (custom fields), Fees, Inspections, Sub-Records, Attachments — returns *"You must be a contact on
> this record to see this information."*** So the public dig proves a permitted service **exists +
> when it was built**, but **amps / voltage / switchgear / kVA are not publicly retrievable**
> (verified at GPMG on NLV permit BD150889). Two ways through:
> **(a)** the **owner logs into the portal as the record contact/applicant** on its own permits →
> unlocks More Info + the approved electrical plan set in Attachments;
> **(b)** go to the **utility** (Stage 4 — the only path to kVA regardless).
> Whenever a tab is gated, **record that it's gated** — "we couldn't see it" is itself a finding that
> reroutes the work, not a dead end.

**Capture per parcel:** new-construction permit(s) + era · any **electrical/commercial-service**
permit numbers · service-upgrade or utility-coordination permits · and a flag for **multiple build
eras / multiple meters** (a parcel built in two phases may carry two services — confirm the count).

---

## Stage 4 — Utility (the only authority for the number that matters)

**Goal:** obtain the **actual transformer kVA / true service capacity** — the only value that can ever
be marked **Confirmed**.

**Method:** an **owner-authorized outbound request** to the electric utility's service-planning /
builder-services desk. There is no public API. The request needs: requestor identity, the parcel
list (verified APNs from Stage 1), and **owner-of-record authorization per owning entity** (Stage 1
gives you exactly the entities to authorize). Ask for: transformer kVA + configuration, service
voltage/phase, meter count, spare capacity, upgrade history, and whether a capacity study is needed
for the planned new load.

This stage is **gated on people, not data** — requestor sign-off, owner signatures, and resolving any
ownership ambiguities surfaced in Stage 1 (e.g. a ground-lease where the fee owner ≠ the
service-account holder). Clear those before sending.

---

## The confidence rubric (apply to every electrical value)

- **Confirmed** — a record states the transformer **kVA explicitly**, *or* the utility confirms it.
  **Only here.**
- **Likely** — service amperage/voltage/switchgear is documented and the transformer is *inferred*.
  Mark **`Inferred? = YES`**, always.
- **Unknown** — no electrical record found; any assumption is ungrounded. Say so plainly.

---

## Running this on a new project — the checklist

1. **Assemble the roster** — every building/address in scope.
2. **Stage 1** — geocode → GIS parcel → **owner-verify on the assessor detail page**. One row per
   building; default to one service each. *Do not trust the first-pass GIS APN.*
3. **Stage 2** — centroid-in-boundary for every parcel → AHJ. Validate against known parcels first.
4. **Stage 3** — group parcels by AHJ portal; identify each portal's system (EnerGov / Accela /
   proprietary) and its public yield *before* digging. Capture permit inventory + era; record any
   gated tabs.
5. **Stage 4** — build the owner-authorized utility request from the verified owner entities; resolve
   ownership ambiguities; send; mark rows **"Likely + utility request pending"** until it returns.
6. **Tag everything** with the confidence rubric. Ship the evidence table with sources, not prose.

**Three artifacts the run should leave behind** (GPMG equivalents in `docs/intel/`):
- a **master validation doc** with the per-parcel evidence table + findings
  (`electrical-service-validation.md`),
- an **operator worksheet** grouped by AHJ portal with pre-filled search keys
  (`permit-stage2-worksheet.md`),
- a **utility request** with the per-owner authorization block
  (`nv-energy-service-request.md`).

---

## Worked example — GPMG North Las Vegas (2026-06-03)

- **Stage 1:** 17 buildings → **17 distinct owner-verified parcels**, ~1,157 units. **9 of 14**
  first-pass APNs were wrong (sliver / `X99` master parcels) and were corrected; two false "shared
  parcel" collapses (Donna 1&2; the 1327 H St campus) were reversed.
- **Stage 2:** AHJ resolved for all 17 → **10 City of Las Vegas · 4 North Las Vegas · 2 unincorporated
  Clark County (Enterprise township) · 1 Henderson**.
- **Stage 3:** NLV (4 parcels) dug — permitted commercial services + eras confirmed (Donna 1 BD150889,
  Donna 2 BD150892, Owens BD96712/2008, Yale BD22311/2002 + a lapsed 2020 NV Energy dry-utility
  permit). **Finding 8: Tyler EnerGov gates service size** → these rows stay "service Unknown,"
  rerouted to owner contact-login or the utility. City of LV (10), Clark Co. (2, Accela), Henderson
  (1) still to dig.
- **Stage 4:** not yet sent — all 17 owners verified (the prerequisite is met); gated on requestor
  identity + owner signatures + 3 ownership confirmations (Fletcher, O'Callaghan, Smith Williams).

**Net:** parcel, owner, and jurisdiction are **Confirmed** for all 17; **every transformer kVA is
still Unknown by design** — closing that is exactly what Stages 3-contact-login and 4 are for. The
methodology's value is that this end-state is *honest and sourced*, not a pile of unvalidated
assumptions.
