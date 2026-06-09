"""Parse the authoritative source — docs/intel/electrical-service-validation.md.

The repo .md is the single source of truth; this module reads it fail-loud (like
the-stack's site_reality.py — never silently emits 0 rows) and returns one record
per GPMG building with the auto fields the Notion sync is allowed to own.

Two tables in the .md are the spine — joined on normalized building name:
  * Stage 4b matrix   (header "Inferred service") -> 3-phase + interconnect verdict
  * Stage 4 evidence  (header "Property | Address | APN") -> APN, transformer state,
                        kVA (if ever stated), parcel confidence

The APN comes only from the evidence table (the matrix has none); the sync matches
Notion rows by APN. Old Windsor Park (the 18th, redevelopment) is in neither table,
so it is never touched — correct.

HARD RULE mirrored from the doc: Transformer is "Confirmed" ONLY when a kVA is
stated (or NV Energy confirms). Until then Unknown, kVA empty.
"""
from __future__ import annotations

import os
import re

DOC = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "electrical-service-validation.md"))
EXPECTED = 17  # the 17 GPMG buildings; Old Windsor Park is not electrical


class ValidationParseError(RuntimeError):
    pass


def _fail(reason: str):
    raise ValidationParseError(
        f"electrical-service-validation.md parse failed: {reason}. "
        f"The source table shape changed — fix the parser before syncing "
        f"(refusing to emit a partial/empty result).")


def _read() -> str:
    if not os.path.exists(DOC):
        _fail(f"source not found at {DOC}")
    with open(DOC, encoding="utf-8") as f:
        return f.read()


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_sep(cells: list[str]) -> bool:
    return all(re.fullmatch(r"[-:\s]+", c or "-") for c in cells)


def _table_rows(text: str, header_substr: str) -> list[list[str]]:
    """Return data-row cell-lists for the table whose header contains header_substr."""
    lines = text.splitlines()
    hdr = next((i for i, ln in enumerate(lines)
                if ln.lstrip().startswith("|") and header_substr in ln), None)
    if hdr is None:
        _fail(f"table header containing '{header_substr}' not found")
    rows = []
    for ln in lines[hdr + 1:]:
        if not ln.lstrip().startswith("|"):
            break
        cells = _cells(ln)
        if _is_sep(cells):
            continue
        rows.append(cells)
    if not rows:
        _fail(f"table '{header_substr}' had a header but zero data rows")
    return rows


# ---- field mappers (raw .md token -> exact Notion select option) -------------

def _service_select(cell: str) -> str:
    m = re.search(r"(277/480|120/208)", cell)  # first voltage wins (handles "poss. 480 step-down")
    if not m:
        _fail(f"unrecognized inferred-service cell: {cell!r}")
    return "Likely 277/480V 3-phase" if m.group(1) == "277/480" else "Likely 120/208V 3-phase"


def _interconnect_select(cell: str) -> str:
    if "▲" in cell:   # ▲
        return "AMBER (leans feasible)"
    if "▼" in cell:   # ▼
        return "AMBER (upgrade likely)"
    if "AMBER" in cell.upper():
        return "AMBER (study)"
    _fail(f"unrecognized interconnect cell: {cell!r}")


def _transformer_state(confidence: str) -> tuple[str, float | None]:
    m = re.search(r"Transformer:\s*\*\*([^*]+)\*\*", confidence)
    if not m:
        _fail(f"no Transformer token in confidence cell: {confidence!r}")
    tok = m.group(1).strip()
    if tok.startswith("Unknown"):
        return "Unknown", None
    if tok.startswith("Likely"):
        return "Likely", None
    if tok.startswith("Confirmed"):
        kva = re.search(r"(\d+(?:\.\d+)?)\s*kVA", tok)
        return "Confirmed", (float(kva.group(1)) if kva else None)
    _fail(f"unrecognized Transformer state: {tok!r}")


def _parcel_select(confidence: str) -> str | None:
    m = re.search(r"Parcel:\s*\*\*([^*]+)\*\*", confidence)
    if m and m.group(1).strip().startswith("Confirmed"):
        return "Confirmed (owner-verified)"
    return None


def _nv_energy_state(transformer: str, confidence: str, gaps: str) -> str:
    """Confirmed transformer => NV Energy returned; an explicit 'sent' note => Sent;
    otherwise the current real-world state: owners verified, request ready to send."""
    if transformer == "Confirmed":
        return "Returned"
    if re.search(r"NV Energy[^.]*\b(sent|request sent|submitted)\b", f"{confidence} {gaps}", re.I):
        return "Sent"
    return "Owner-verified — ready"


def _apn(text: str) -> str | None:
    m = re.search(r"\d{11}", text)
    return m.group(0) if m else None


def last_verified(text: str) -> str:
    m = re.search(r"Stage 4b.*?✅\s*(\d{4}-\d{2}-\d{2})", text)
    if not m:
        _fail("could not read the Stage 4b verification date (✅ YYYY-MM-DD)")
    return m.group(1)


# ---- public: build the 17 site records ---------------------------------------

def build_sites() -> list[dict]:
    text = _read()
    verified = last_verified(text)

    matrix = {}
    for c in _table_rows(text, "Inferred service"):
        if not (c and c[0].isdigit()):
            continue
        if len(c) < 8:
            _fail(f"matrix row has {len(c)} cells (<8): {c}")
        matrix[_norm(c[1])] = {
            "building": c[1],
            "3-Phase (inferred)": _service_select(c[4]),
            "Interconnect (provisional)": _interconnect_select(c[7]),
        }

    evidence = {}
    for c in _table_rows(text, "Gaps / follow-up"):  # substring unique to the Stage 4 evidence table
        if not c or c[0] in ("Property", "") or _is_sep(c):
            continue
        if len(c) < 9:
            _fail(f"evidence row has {len(c)} cells (<9): {c}")
        apn = _apn(c[2])
        if not apn:
            _fail(f"no 11-digit APN in evidence row: {c[0]!r} / {c[2]!r}")
        transformer, kva = _transformer_state(c[7])
        evidence[_norm(c[0])] = {
            "building": c[0],
            "APN": apn,
            "Transformer": transformer,
            "Transformer kVA": kva,
            "Parcel": _parcel_select(c[7]),
            "NV Energy": _nv_energy_state(transformer, c[7], c[8]),
        }

    if len(matrix) != EXPECTED:
        _fail(f"expected {EXPECTED} matrix rows, parsed {len(matrix)}")
    if len(evidence) != EXPECTED:
        _fail(f"expected {EXPECTED} evidence rows, parsed {len(evidence)}")

    sites = []
    for mkey, mrow in matrix.items():
        ekey = _join(mkey, evidence)
        if ekey is None:
            _fail(f"matrix building {mrow['building']!r} has no evidence-table match")
        erow = evidence[ekey]
        sites.append({
            "building": mrow["building"],
            "APN": erow["APN"],
            "last_verified": verified,
            "auto": {
                "3-Phase (inferred)": mrow["3-Phase (inferred)"],
                "Interconnect (provisional)": mrow["Interconnect (provisional)"],
                "Transformer": erow["Transformer"],
                "Transformer kVA": erow["Transformer kVA"],
                "Parcel": erow["Parcel"],
                "NV Energy": erow["NV Energy"],
            },
        })
    if len(sites) != EXPECTED:
        _fail(f"joined {len(sites)} sites, expected {EXPECTED}")
    return sites


def _join(mkey: str, evidence: dict) -> str | None:
    """Match a matrix building to its evidence row by normalized name, tolerating a
    suffix difference (evidence 'David J. Hoggard Family' vs matrix 'David J. Hoggard').
    Bidirectional prefix is safe here — no GPMG building name is a prefix of another."""
    if mkey in evidence:
        return mkey
    hits = [k for k in evidence if k.startswith(mkey) or mkey.startswith(k)]
    return hits[0] if len(hits) == 1 else None


if __name__ == "__main__":  # token-free self-test
    import json
    _sites = build_sites()
    print(f"OK — parsed {len(_sites)} sites; verified {_sites[0]['last_verified']}\n")
    for _s in _sites:
        print(f"  {_s['building']:<30} APN {_s['APN']}")
        print("      " + json.dumps(_s["auto"], ensure_ascii=False))
