#!/usr/bin/env python3
"""
Extract HUD Handbook 4350.3 REV-1 from its split text-layer PDFs into faithful,
lightly-cleaned Markdown tranches.

Source: /Volumes/SSD/Downloads/  (two representations of the same ~800pp handbook)
Output: docs/reference/hud-4350.3/{index.md, hud-4350.3-ppNNN-NNN.md}

Extraction is deterministic (pdftotext text layer) — NOT OCR. No LLM/vision calls.
"""
import os
import re
import subprocess
import sys
from datetime import date
from glob import glob

SRC = "/Volumes/SSD/Downloads"
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "reference", "hud-4350.3")
OUT = os.path.abspath(OUT)
GEN_DATE = date.today().isoformat()


def pdftext(path):
    """Return -layout text of a PDF, or raise on failure."""
    r = subprocess.run(["pdftotext", "-layout", path, "-"],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"pdftotext failed on {path}: {r.stderr.strip()}")
    return r.stdout


def page1to100_sources():
    files = glob(os.path.join(SRC, "Housing long doc", "4350.3 LIHTC MANUAL *.pdf"))
    def num(p):
        m = re.search(r"MANUAL (\d+)\.pdf$", p)
        return int(m.group(1)) if m else 1 << 30
    return sorted(files, key=num)


# (out_basename, page-range label, [ordered source pdf paths])
def tranches():
    lh = lambda *p: os.path.join(SRC, *p)
    return [
        ("hud-4350.3-pp001-100", "1–100",   page1to100_sources()),
        ("hud-4350.3-pp100-200", "100–200", [lh("Long Housing 100-200", "100-150.pdf"),
                                              lh("Long Housing 100-200", "150-200.pdf")]),
        ("hud-4350.3-pp200-300", "200–300", [lh("Long Housing 200-300", "200-250.pdf"),
                                              lh("Long Housing 200-300", "Pages from 4350.3 LIHTC MANUAL-3.pdf")]),
        ("hud-4350.3-pp300-400", "300–400", [lh("Long Housing 300-400", "Pages from 4350.3 LIHTC MANUAL-4.pdf")]),
        ("hud-4350.3-pp400-500", "400–500", [lh("Long Housing 400-500", "Pages from 4350.3 LIHTC MANUAL-5.pdf")]),
        ("hud-4350.3-pp500-600", "500–600", [lh("Long Housing 500-600", "Pages from 4350.3 LIHTC MANUAL-6.pdf")]),
        ("hud-4350.3-pp600-700", "600–700", [lh("Long Housing 600-700", "Pages from 4350.3 LIHTC MANUAL-7.pdf")]),
        ("hud-4350.3-pp700-794", "700–794", [lh("Long Housing 700-800", "Pages from 4350.3 LIHTC MANUAL-8.pdf")]),
    ]


# --- light, faithful cleanup -------------------------------------------------
RE_PAGELOC   = re.compile(r"^\s*\d{1,2}-\d{1,3}\s*$")          # bare "3-15" footer
RE_DATEFOOT  = re.compile(r"^\s*\d{1,2}/\d{2}\s*$")            # bare "6/07" footer
RE_LOC_TOK   = re.compile(r"\b\d{1,2}-\d{1,3}\b")
RE_DATE_TOK  = re.compile(r"\b\d{1,2}/\d{2}\b")
RE_HDR       = re.compile(r"^\s*4350\.3\s+REV-1\b(.*)$")       # header (maybe + locator)
RE_FORMFEED  = re.compile(r"\x0c")
RE_CHAPTER   = re.compile(r"^\s*(CHAPTER\s+\d+\.\s+.*\S)\s*$")
RE_PARA      = re.compile(r"^\s{0,10}(\d+-\d+)\s{2,}([A-Z][^\n]*\S)\s*$")


def is_running(line):
    """True for running headers/footers, but NOT prose that merely cites the handbook."""
    # footer: "<date> <loc> HUD Occupancy Handbook" / "HUD Occupancy Handbook ... <loc>"
    if "HUD Occupancy Handbook" in line and (RE_LOC_TOK.search(line) or RE_DATE_TOK.search(line)):
        return True
    # header: line begins with "4350.3 REV-1" and the remainder is only a locator/date
    m = RE_HDR.match(line)
    if m:
        rest = m.group(1).strip()
        if rest == "" or re.fullmatch(r"[\d\-/ ]*", rest):
            return True
    return RE_PAGELOC.match(line) or RE_DATEFOOT.match(line)


def clean(text):
    out = []
    blanks = 0
    for raw in RE_FORMFEED.sub("\n", text).split("\n"):
        line = raw.rstrip()
        if is_running(line):
            continue
        if not line.strip():
            blanks += 1
            if blanks > 1:
                continue
            out.append("")
            continue
        blanks = 0
        m = RE_CHAPTER.match(line)
        if m:
            out += ["", f"## {m.group(1)}", ""]
            continue
        m = RE_PARA.match(line)
        if m:
            out += ["", f"### {m.group(1)} {m.group(2)}", ""]
            continue
        out.append(line)
    # trim leading/trailing blank lines
    while out and not out[0].strip():
        out.pop(0)
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out) + "\n"


def main():
    os.makedirs(OUT, exist_ok=True)
    index_rows = []
    warnings = []
    for base, label, srcs in tranches():
        missing = [s for s in srcs if not os.path.exists(s)]
        if missing:
            warnings.append(f"{base}: missing sources -> {missing}")
        parts = [pdftext(s) for s in srcs if os.path.exists(s)]
        body = clean("\n\n".join(parts))
        if len(body.strip()) < 200:
            warnings.append(f"{base}: near-empty extraction ({len(body)} chars) — candidate for vision fallback")
        srcnames = ", ".join(os.path.basename(s) for s in srcs)
        front = (
            f"<!-- Source: HUD Handbook 4350.3 REV-1 (Nov 2013), pages {label} -->\n"
            f"<!-- Extracted from PDF text layer via pdftotext — not OCR. Generated {GEN_DATE}. -->\n"
            f"<!-- Source files: {srcnames} -->\n\n"
            f"# HUD Handbook 4350.3 — pages {label}\n\n"
        )
        path = os.path.join(OUT, base + ".md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(front + body)
        index_rows.append((base + ".md", label, len(body)))
        print(f"wrote {path}  ({len(body):,} chars from {len(parts)} source(s))")

    # index.md
    idx = [
        "# HUD Handbook 4350.3 REV-1 — Occupancy Requirements of Subsidized Multifamily Housing Programs",
        "",
        "*November 2013. Extracted from the embedded PDF text layer (pdftotext, `-layout`) — "
        "not OCR. Faithful transcription with light structural cleanup.*",
        "",
        f"Generated: {GEN_DATE}  ·  Source: `/Volumes/SSD/Downloads/` (Long Housing chunks + Housing long doc).",
        "",
        "## Tranches",
        "",
        "| Pages | File |",
        "| --- | --- |",
    ]
    for name, label, _ in index_rows:
        idx.append(f"| {label} | [{name}]({name}) |")
    idx.append("")
    with open(os.path.join(OUT, "index.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(idx))
    print(f"wrote {os.path.join(OUT, 'index.md')}")

    if warnings:
        print("\n=== WARNINGS ===", file=sys.stderr)
        for w in warnings:
            print("  ! " + w, file=sys.stderr)


if __name__ == "__main__":
    main()
