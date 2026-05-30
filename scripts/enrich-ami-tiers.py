#!/usr/bin/env python3
"""
Enrich the served statewide snapshot (client-tenant/public/nv-housing-props.json)
with amiTiers, IN PLACE.

The committed snapshot (335 props, HUD-LIHTC-sourced — funding vocab LIHTC /
HOME / Tax-Exempt Bond) is a different property universe than the NHD LIHD
spreadsheet, so we do NOT regenerate from NHD (that would swap datasets and drop
currently-shown properties). Instead we keep every committed record exactly as
is and only fill its empty `amiTiers` by matching to NHD, where the AMI
set-aside tiers actually live.

Matching is confidence-tiered to avoid attributing the wrong AMI tiers:
  - coord  <  ~110 m                          -> accept (same building)
  - coord  <  ~250 m  AND name Jaccard >= .3  -> accept (same site, geocode drift)
  - name Jaccard >= .6                         -> accept (renamed/relocated geocode)
Only NHD rows that actually carry amiTiers contribute. Funding is left untouched
(keeps the snapshot's vocabulary internally consistent).

Usage: python3 scripts/enrich-ami-tiers.py [path-to-nhd-xlsx]
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "client-tenant" / "public" / "nv-housing-props.json"
DEFAULT_XLSX = "/Volumes/SSD/Downloads/NHD_LIHD_2025-11-26.xlsx"

# NHD "LIHD - All" column indices (0-based) — same map as build-housing-data.py.
C = {"name": 1, "aka": 2, "lat": 9, "lng": 10, "setasides": 13}

STOP = {"apts", "apartments", "apartment", "the", "of", "and", "aka", "senior",
        "seniors", "ii", "iii", "iv", "i", "phase", "ph"}


def fix_coord(v, hard):
    if not isinstance(v, (int, float)):
        return None
    v = float(v)
    g = 0
    while abs(v) > hard and g < 12:
        v /= 10.0
        g += 1
    return v


def parse_ami_tiers(setasides):
    if not setasides:
        return []
    s = str(setasides)
    tiers = []
    for pct in re.findall(r"(\d{2,3})\s*%", s):
        label = f"{pct}%"
        if label not in tiers:
            tiers.append(label)
    if re.search(r"\bmkt\b|market", s, re.I) and "Market" not in tiers:
        tiers.append("Market")
    return tiers


def toks(*names):
    s = re.sub(r"[^a-z0-9 ]", " ", " ".join(str(n or "") for n in names).lower())
    return {t for t in s.split() if len(t) > 1 and t not in STOP}


def load_nhd(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["LIHD - All"]
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r or not r[C["name"]]:
            continue
        lat = fix_coord(r[C["lat"]], 90)
        lng = fix_coord(r[C["lng"]], 180)
        tiers = parse_ami_tiers(r[C["setasides"]])
        if lat is None or lng is None or not tiers:
            continue
        out.append({
            "name": str(r[C["name"]]).strip(),
            "aka": str(r[C["aka"]]).strip() if r[C["aka"]] else "",
            "lat": lat, "lng": lng, "tiers": tiers,
        })
    return out


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def best_match(o, nhd):
    o_tok = toks(o["name"], o.get("aka"))
    best = None
    best_d = 9.0
    for n in nhd:
        d = ((o["lat"] - n["lat"]) ** 2 + (o["lng"] - n["lng"]) ** 2) ** 0.5
        if d < best_d:
            best_d = d
            best = n
    if not best:
        return None, None
    j = jaccard(o_tok, toks(best["name"], best["aka"]))
    if best_d < 0.001:
        return best, f"coord<110m d={best_d:.5f}"
    if best_d < 0.0025 and j >= 0.3:
        return best, f"coord<250m+name d={best_d:.5f} j={j:.2f}"
    if j >= 0.6:
        return best, f"name j={j:.2f} d={best_d:.5f}"
    return None, None


def main():
    xlsx = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    if not Path(xlsx).exists():
        sys.exit(f"xlsx not found: {xlsx}")
    snap = json.loads(SNAPSHOT.read_text())
    nhd = load_nhd(xlsx)
    print(f"snapshot: {len(snap)} | nhd rows w/ amiTiers+coords: {len(nhd)}")

    filled = 0
    samples = []
    for o in snap:
        if o.get("amiTiers"):
            continue
        match, why = best_match(o, nhd)
        if match:
            o["amiTiers"] = match["tiers"]
            filled += 1
            if len(samples) < 12:
                samples.append((o["name"], match["name"], match["tiers"], why))

    print(f"filled amiTiers: {filled} / {len(snap)}  "
          f"(left empty: {sum(1 for p in snap if not p['amiTiers'])})")
    print("--- sample matches (snapshot name  <-  NHD name : tiers : why) ---")
    for sn, nn, t, why in samples:
        print(f"  {sn[:34]:34s} <- {nn[:34]:34s} {t}  [{why}]")

    # indent=2 matches the committed file so the git diff shows only amiTiers.
    SNAPSHOT.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {SNAPSHOT} ({SNAPSHOT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
