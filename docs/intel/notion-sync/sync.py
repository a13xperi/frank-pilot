#!/usr/bin/env python3
"""Repo -> Notion sync for the GPMG NV Parcels DB (one-way, auto fields only).

The repo .md (docs/intel/electrical-service-validation.md) is authoritative. This
pushes ONLY the source-derived electrical/parcel fields into the matching Notion
row (matched by APN). It is deliberately incapable of touching judgment fields.

  OWNED (patched, only when changed):
      3-Phase (inferred), Interconnect (provisional), Transformer,
      Transformer kVA, Parcel, NV Energy, Last verified
  NEVER SENT (not in the payload at all):
      Flag, Authorization, Program tier, Assigned entity, Credits in play,
      Capacity fee, BESS kW/kWh, Site type, and every identity column
  ROW-LEVEL GUARD:
      any row whose "Sync source" select == "manual" is skipped entirely

The NV-Energy-returns-kVA flip is automatic: edit the .md evidence row to
  Transformer: **Confirmed (300 kVA, NV Energy 2026-07-xx)**
and the next run sets Transformer=Confirmed, Transformer kVA=300, NV Energy=Returned,
and bumps Last verified — because the parser derives all of that from the source.

Default mode is DRY-RUN (prints the diff, writes nothing). Pass --apply to write.

  python3 sync.py            # dry run: show what would change
  python3 sync.py --apply    # write the auto fields to Notion
  python3 sync.py --check    # dry run; exit 1 if any site row is missing/unmatched
"""
from __future__ import annotations

import os
import re
import sys

import notion
import validation

DS_ID = os.environ.get("GPMG_DS_ID", "72aafa8d-405e-4bd3-a511-f3b092813687")

OWNED = [
    "3-Phase (inferred)", "Interconnect (provisional)", "Transformer",
    "Transformer kVA", "Parcel", "NV Energy", "Last verified",
]


def load_env(path: str) -> None:
    """Load KEY=VALUE from .env; existing shell env wins (setdefault)."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _apn11(s: str) -> str | None:
    m = re.search(r"\d{11}", s or "")
    return m.group(0) if m else None


def _current(page: dict, field: str):
    if field == "Transformer kVA":
        return notion.prop_number(page, field)
    if field == "Last verified":
        d = page.get("properties", {}).get(field, {}).get("date")
        return d.get("start") if d else None
    return notion.prop_select(page, field)


def _desired(site: dict, field: str):
    if field == "Last verified":
        return site["last_verified"]
    return site["auto"][field]


def _prop_for(site: dict, field: str) -> dict:
    if field == "Transformer kVA":
        return notion.number(site["auto"][field])
    if field == "Last verified":
        return notion.date(site["last_verified"])
    return notion.select(site["auto"][field])


def _eq(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and float(a) == float(b)
    return a == b


def main(argv: list[str]) -> int:
    apply = "--apply" in argv
    check = "--check" in argv

    load_env(os.path.join(os.path.dirname(__file__), ".env"))

    try:
        sites = validation.build_sites()
    except validation.ValidationParseError as e:
        print(f"PARSE ERROR: {e}", file=sys.stderr)
        return 1

    print(f"Parsed {len(sites)} sites from {os.path.relpath(validation.DOC)}")
    print(f"Mode: {'APPLY (writing)' if apply else 'DRY-RUN (no writes)'}  DS={DS_ID}\n")

    try:
        rows = notion.query_all(DS_ID)
    except notion.NotionError as e:
        print(f"NOTION ERROR: {e}", file=sys.stderr)
        return 1

    by_apn = {}
    for r in rows:
        apn = _apn11(notion.prop_text(r, "APN"))
        if apn:
            by_apn[apn] = r

    changed = unchanged = skipped = patched = 0
    missing: list[str] = []

    for site in sites:
        bld, apn = site["building"], site["APN"]
        page = by_apn.get(apn)
        if not page:
            missing.append(f"{bld} (APN {apn})")
            print(f"  MISSING  {bld:<30} no Notion row with APN {apn}")
            continue

        if notion.prop_select(page, "Sync source") == "manual":
            skipped += 1
            print(f"  SKIP     {bld:<30} Sync source = manual (row is hand-maintained)")
            continue

        diffs = [(f, _current(page, f), _desired(site, f))
                 for f in OWNED if not _eq(_current(page, f), _desired(site, f))]
        if not diffs:
            unchanged += 1
            continue

        changed += 1
        print(f"  CHANGE   {bld}")
        for f, cur, des in diffs:
            print(f"             {f}: {cur!r} -> {des!r}")

        if apply:
            props = {f: _prop_for(site, f) for f, _, _ in diffs}
            assert set(props) <= set(OWNED), "refusing to write a non-owned field"
            notion.patch_row(page["id"], props)
            patched += 1

    print(f"\nSummary: {changed} changed, {unchanged} unchanged, {skipped} manual-skip, "
          f"{len(missing)} missing"
          + (f", {patched} patched" if apply else ""))
    if missing:
        print("Missing rows: " + "; ".join(missing), file=sys.stderr)

    if check and missing:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
