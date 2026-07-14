# GPMG NV Parcels — repo → Notion sync

One-way sync that keeps the **auto** (source-derived) fields of the *GPMG NV
Parcels* Notion DB in agreement with the authoritative repo file
[`../electrical-service-validation.md`](../electrical-service-validation.md).

**The repo `.md` is the single source of truth.** Notion is a read/collaboration
surface. This tool only ever pushes repo → Notion; it never reads judgment back.

## What it touches

| Field | Owned? | Behaviour |
|---|---|---|
| `3-Phase (inferred)`, `Interconnect (provisional)`, `Transformer`, `Transformer kVA`, `Parcel`, `NV Energy`, `Last verified` | **OWNED** | patched, and only when the value actually changed |
| `Flag`, `Authorization`, `Program tier`, `Assigned entity`, `Credits in play`, `Capacity fee`, `BESS kW/kWh`, `Site type`, every identity column | **never** | not in the payload — the tool is structurally incapable of writing them |

Two protections, belt-and-suspenders:
1. **Field allowlist** — the PATCH payload is built only from the OWNED list.
2. **Row guard** — any row whose `Sync source = manual` is skipped entirely, so a
   row can be pinned for hand-maintenance and the sync will leave the *whole* row
   alone.

Rows are matched to sites by **APN**. Old Windsor Park (the 18th, a redevelopment
proposal with no electrical service) is in neither source table, so it is never
touched.

## The NV-Energy flip is automatic

Transformer stays `Unknown` until the source states a kVA (the hard rule). When NV
Energy returns, edit the evidence row in the `.md`:

```
… · Transformer: **Confirmed (300 kVA, NV Energy 2026-07-14)**
```

The next `--apply` run derives `Transformer=Confirmed`, `Transformer kVA=300`,
`NV Energy=Returned` from that line and bumps `Last verified`. No code change, no
hand-editing in Notion — one edit to the source of truth propagates.

## Usage

```bash
cd docs/intel/notion-sync
cp .env.example .env          # paste a NOTION_TOKEN connected to the GPMG NV Parcels page
python3 sync.py               # DRY RUN — prints the before→after diff, writes nothing
python3 sync.py --apply       # writes the auto fields to Notion
python3 sync.py --check       # dry run; exits 1 if any site has no matching Notion row (CI)
```

Stdlib only (Python 3.10+, `urllib`) — no `pip install`. The token is read from
`.env` then the shell env, and is never logged.

## Self-test (no token needed)

```bash
python3 validation.py         # parses the .md, prints the 17 site records, fails loud on drift
```

The parser refuses to emit a partial/empty result: if either source table changes
shape it raises `ValidationParseError` rather than silently syncing 0 rows.

## Files

- `validation.py` — fail-loud parser for the two source tables (Stage 4b matrix +
  Stage 4 evidence), joined by building name.
- `notion.py` — stdlib Notion REST client (2025-09-03 data_source API).
- `sync.py` — orchestrator: parse → match by APN → diff → patch owned fields.
