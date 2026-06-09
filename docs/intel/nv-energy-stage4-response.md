# NV Energy Stage-4 — response receiver kit (GPMG portfolio)

> **Purpose.** The turnkey landing pad for NV Energy's reply to the Stage-4 request
> (`nv-energy-stage4-email.md`). When the data arrives, paste each premise's answers into the **intake
> grid** below, apply the **deterministic flip rule**, then run the **ingest runbook** — the verdicts in
> `electrical-service-validation.md` and the-stack §1.5 graduate `Likely → Confirmed` and `AMBER → GREEN/RED`,
> and the Notion System-Status rows auto-sync on commit. Ingest is a ~30-minute paste-and-commit, not a
> re-analysis.
>
> **State today:** request **drafted, not yet sent** (owner-auth is Alex's action — see the email's 3
> ownership caveats + 14-entity Attachment A). All 17 premises are **Likely 3-phase / 0 Confirmed / all
> provisional AMBER**. This file is the receiver, staged in advance; the grid is intentionally blank.

---

## 1 · Intake grid — raw answers (one row per premise, keyed by APN)

Transcribe NV Energy's reply verbatim. Roster order + APN/owner/units mirror `nv-energy-stage4-email.md:31-49`
(already owner-verified — do **not** re-derive). Leave a cell `—` if NV Energy didn't answer it; a blank cell
is itself a finding (keeps that gate **AMBER**).

| # | Property | APN | ① Transformer kVA + config | ② Voltage / phase | ③ Meters / shared-service | ④ Spare cap · peak kW · upgrade hx | ⑤ ESR / load-letter (180 kW) | ⑥ BESS pathway · feeder HCA kW |
|---|----------|-----|---------------------------|-------------------|---------------------------|-----------------------------------|------------------------------|--------------------------------|
| 1 | Donna Louise 1 | 12426103004 | | | | | | |
| 2 | Donna Louise 2 | 12426103002 | | | | | | |
| 3 | Owens Senior Housing | 13922810039 | | | | | | |
| 4 | Yale Keyes Senior | 13922810051 | | | | | | |
| 5 | Aldene Kline Barlow (1327 H St UT 1) | 13928503028 | | | | | | |
| 6 | Ethel Mae Robinson (1327 H St UT 2) | 13928503027 | | | | | | |
| 7 | Sarann Knight (1327 H St UT 3) | 13928503026 | | | | | | |
| 8 | David J. Hoggard Family | 13928503022 | | | | | | |
| 9 | Luther Mack, Jr. Senior | 17716101027 | | | | | | |
| 10 | Dr. Paul Meacham Senior | 17716101026 | | | | | | |
| 11 | Ethel Mae Fletcher | 13825504001 | | | | | | |
| 12 | Mike O'Callaghan Legacy | 13825518004 | | | | | | |
| 13 | Juan Garcia Garden | 13936402015 | | | | | | |
| 14 | Louise Shell Senior | 13921202007 | | | | | | |
| 15 | Senator Harry Reid Senior | 13935201001 | | | | | | |
| 16 | Senator Richard Bryan Senior | 13925101022 | | | | | | |
| 17 | Smith Williams Senior | 17908301011 | | | | | | |

**Cluster note (ask ③):** rows 5/6/7 are the **1327 H St** campus (UT 1/2/3) and rows 1/2 are **Donna Louise
1 & 2** — record whether each shares service or is metered separately; this can collapse or split how many
distinct transformers the verdict applies to.

---

## 2 · Computed verdict — derived, not transcribed (keyed by APN)

Fill from §1 via the flip rule in §3. The **"§4b row"** column is the matching row in
`electrical-service-validation.md:290-308` (ordered differently from this grid — match by **APN**, never by row
number).

| # | Property | APN | §4b row | Confirmed service (kVA · V/φ) | Headroom test (Gate L) | Feeder test (Gate D) | **Interconnect → G/A/R** |
|---|----------|-----|---------|-------------------------------|------------------------|----------------------|--------------------------|
| 1 | Donna Louise 1 | 12426103004 | 5 | | | | |
| 2 | Donna Louise 2 | 12426103002 | 6 | | | | |
| 3 | Owens Senior Housing | 13922810039 | 13 | | | | |
| 4 | Yale Keyes Senior | 13922810051 | 17 | | | | |
| 5 | Aldene Kline Barlow | 13928503028 | 1 | | | | |
| 6 | Ethel Mae Robinson | 13928503027 | 2 | | | | |
| 7 | Sarann Knight | 13928503026 | 3 | | | | |
| 8 | David J. Hoggard Family | 13928503022 | 4 | | | | |
| 9 | Luther Mack, Jr. Senior | 17716101027 | 7 | | | | |
| 10 | Dr. Paul Meacham Senior | 17716101026 | 8 | | | | |
| 11 | Ethel Mae Fletcher | 13825504001 | 9 | | | | |
| 12 | Mike O'Callaghan Legacy | 13825518004 | 10 | | | | |
| 13 | Juan Garcia Garden | 13936402015 | 11 | | | | |
| 14 | Louise Shell Senior | 13921202007 | 12 | | | | |
| 15 | Senator Harry Reid Senior | 13935201001 | 14 | | | | |
| 16 | Senator Richard Bryan Senior | 13925101022 | 15 | | | | |
| 17 | Smith Williams Senior | 17908301011 | 16 | | | | |

---

## 3 · The flip rule (deterministic — this is the documented standard)

> Supersedes the prose verdict rubric formerly inline in `electrical-service-validation.md` (§ "P3 —
> interconnection screen"). That file now points here.

A site's interconnect verdict is set by **two independent gates**. Both must be answerable from the reply; a
gate whose input is still missing/gated keeps the site **AMBER**.

**Inputs (per premise, from the grid):**
- **kVA** = serving transformer rating (ask ①)
- **peak** = measured peak demand of record, kW (ask ④); **spare** = stated spare capacity, kW (ask ④, if given)
- **HCA** = feeder hosting capacity, kW (ask ⑥)
- Fixed loads: **+180 kW** firm compute (continuous); **250 kW / 400–500 kWh** BESS, **non-export / behind-the-meter** (a peak-shave mitigation, not a new export source).

**Gate L — transformer headroom (the LOAD / ESR test):** can the existing service carry +180 kW firm compute?
- `headroom_kW = spare`  *(prefer NV Energy's stated spare)*  **or, if spare not given,** `headroom_kW = kVA · 0.9 · 0.9 − peak`  *(0.9 utilisation × 0.9 PF; note the PF assumption inline)*.
- BESS peak-shave credits up to its continuous discharge against the coincident peak, so the **effective load to absorb ≈ `max(0, 180 − peak-shave credit)`**. Use NV Energy's ESR study outcome (ask ⑤) where it supersedes this estimate.
- **Pass** if `headroom_kW ≥ effective load to absorb`. **Hard-fail** if the transformer can't host +180 kW even with full BESS peak-shave.

**Gate D — feeder interconnection (the DER / BESS test):** does the 250 kW BESS clear NV Energy's screen?
- **Pass** if `HCA ≥ 250 kW` **and** the BESS clears the **15%-of-feeder-peak-load** screen (non-export expedites). Take NV Energy's PowerClerk/DRP determination (ask ⑥) as authoritative where stated.

**Verdict:**

| Gate L | Gate D | Verdict | Meaning |
|--------|--------|---------|---------|
| pass | pass | **GREEN** | feasible on existing service |
| hard-fail | (any) | **RED** | mandatory service upgrade (adds CapEx — triggers runbook step ⑧) |
| pass/unknown | unknown | **AMBER** | kVA confirmed but feeder HCA still gated → genuine capacity study |
| unknown | unknown | **AMBER** | data still partial |

**Lean markers** (keep the existing ▲/▼ glyphs only while a row is still AMBER): ▲ leans-feasible · flat
capacity-study · ▼ upgrade-likely. A GREEN or RED row drops the lean glyph.

> **Confidence is separate from the verdict.** A row's **Confidence** graduates `Unknown/Likely → Confirmed`
> the moment NV Energy states the **kVA** (ask ①) — that is the only authoritative source, per the hard rule
> in `METHODOLOGY.md:144-150`. Voltage/phase (ask ②) confirms the service descriptor but **kVA is what makes
> the row Confirmed.**

---

## 4 · Row-state convention (set when the email is sent, before any reply)

Per `nv-energy-stage4-email.md:92-93`: on **send**, annotate each Stage-4 row
`Likely + NV Energy request pending [YYYY-MM-DD]` (do not change the verdict). Only a **reply** flips a row to
`Confirmed`. This marks the portfolio as "asked, awaiting" so the gated state is intentional, not an open TODO.

---

## 5 · Ingest runbook — execute ON REPLY (Track B)

1. **Transcribe** NV Energy's answers into §1 (verbatim; `—` for unanswered).
2. **Derive** §2 via the §3 flip rule — Confirmed service + Gate L/D + G/A/R per APN.
3. **frank-pilot** — edit `electrical-service-validation.md`:
   - Stage-4 evidence table (`:223-239`): Confidence `Unknown → Confirmed`, write the kVA + source.
   - Stage-4b matrix (`:290-308`): "Inferred service" `Likely → Confirmed` (drop "Likely"), "Interconnect" `AMBER▲/▼ → GREEN/RED` where a gate resolves.
   - Tally (`:310-314`): update Confirmed count + GREEN/RED/AMBER split.
4. **the-stack** — edit `docs/the-stack-whitepaper.md` §1.5:
   - Per-row (`:107-123`): service cell `Likely → Confirmed`, interconnect cell `AMBER → GREEN/RED` — **literal strings matter** (`site_reality._confidence` matches `(confirmed|likely|unknown)`; `_interconnect` matches `GREEN/RED/AMBER`).
   - Tally (`:127-129`): Confirmed N/17, GREEN/RED/AMBER N/17.
5. **Commit the-stack** → the post-commit hook runs `status/sync.py` → `site_reality.py` re-parses §1.5 → **auto-upserts** Notion System-Status rows (`site:service`, `site:interconnection`). **No manual Notion edit for these.**
6. **Conditional (only if any site = RED):** add a service-upgrade CapEx line in `the-stack-whitepaper.md` (`:54-67`, `:346`). Credit figures themselves don't move unless BESS sizing changes.
7. **Roll up:** `frank-pilot docs/intel/README.md:13-20` (Stage 3/4 ⬜ → ✅/🔄); the **Notion "GPMG NV Parcels"** DB (manual — re-fetch its schema at execution); memory `project_gpmg_electrical_e2e_validation.md` (confirmed counts).
8. **Verify** (before pushing): `python3 status/site_reality.py` printed counts == hand-edited §1.5; `python3 status/sync.py --tests-only` then `--dry-run`. **Cross-consistency gate:** frank-pilot tally == the-stack §1.5 tally == `site_reality.py` output == Notion rows.

---

## 6 · Pre-send dependencies (owner — not part of ingest)

The reply can't arrive until the request is sent. The send checklist lives in `nv-energy-stage4-email.md`:
fill 4 fields, resolve the **3 ownership caveats** (Fletcher 1503 vs 1403 · O'Callaghan 1502 vs vacant lot ·
Smith Williams fee owner = the church), and collect **Attachment A** signatures across the **14 owning
entities**. That is the real critical path; this file picks up the moment NV Energy responds.

---

## 7 · Pipeline validation (dry-run, 2026-06-09)

Before any real reply, the receiver and its auto-sync chain were proven end-to-end with **zero side effects**
(two read-only checks + one working-tree flip, reverted — no commit, no Notion write, no push). Re-run any time
to re-confirm; each test is deterministic.

**① Structural integrity** (read-only, parsed from `origin/main` blobs) — **10/10 invariants pass.** §1 intake
= §2 verdict = roster (`nv-energy-stage4-email.md`) = §4b matrix (`electrical-service-validation.md:290-308`),
all **17 rows**; APN sets identical across all four; §1 order mirrors the roster; the §2 **§4b-row column is a
true bijection of 1..17**; and every APN→§4b-row cross-map resolves to the matching building. No drift.

**② Parser baseline** (read-only) — `cd ~/projects/the-stack && python3 status/site_reality.py` reads §1.5
cleanly: `site:service 0/17 Confirmed` · `site:interconnection 0/17 GREEN / 17 AMBER`. Confirms the kit (Track
A) introduced **no accidental flip** — counts still match the pre-kit baseline.

**③ End-to-end flip** (working-tree only, auto-reverted) — simulated NV Energy confirming **Donna Louise 1**
(§4b r5): edited its §1.5 cell `Likely 120/208 V 3φ → Confirmed … (300 kVA)` and `AMBER▼ → GREEN`, re-ran the
parser, then `git checkout --` to revert. The System-Status rows moved exactly as designed and snapped back:

| row | baseline | after 1-row flip | after revert |
|-----|----------|------------------|--------------|
| `site:service` | 0/17 Confirmed | **1/17 Confirmed** (Likely 16/17) | 0/17 ✓ |
| `site:interconnection` | 0/17 GREEN · 17 AMBER (▼7) | **1/17 GREEN** · 16 AMBER (▼6) | 0/17 · 17 AMBER (▼7) ✓ |

The `▼` upgrade-lean count correctly dropped 7→6 (Donna Louise 1 was AMBER▼). This is the exact upsert
`status/sync.py` performs on commit, so editing one §1.5 literal flows deterministically into the Notion
System-Status rows — **Track B is turnkey.**

> ⚠️ The flip test must stay **working-tree-only**. A *commit* on the-stack fires the post-commit hook →
> `sync.py` → real Notion write + `git push` auto-backup. Use `git checkout --` (not a commit) to revert a
> dry-run. The only element still untested is the real reply data, which doesn't exist until NV Energy responds.
