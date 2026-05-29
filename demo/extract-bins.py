#!/usr/bin/env python3
"""
Extract Nevada LIHTC Building Identification Numbers (BINs) from scanned
OneSite "Unit Scheduled Transactions" PDFs emailed by Global Property
Management Group.

Each PDF is one property. Pages are scanned images with zero text layer, so
extraction is fully vision-based. This script handles the Python half of the
pipeline:

  1. `render`  -> rasterize every PDF page to PNG and emit a manifest
                  describing which PNGs belong to which property. The vision
                  pass (Claude Opus subagents) is dispatched by the harness,
                  not by this script.
  2. `merge`   -> combine per-property agent JSON outputs into the final
                  src/db/data/bins.json plus docs/bins-verification.md.

Usage:
  demo/.venv/bin/python3 demo/extract-bins.py render \\
        --pdf-dir /Volumes/SSD/Downloads/bins \\
        --out-dir /tmp/bins-work

  demo/.venv/bin/python3 demo/extract-bins.py merge \\
        --work-dir /tmp/bins-work \\
        --agent-dir /tmp/bins-work/agent-out
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import pdfplumber
from pdf2image import convert_from_path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_BINS_JSON = ROOT / "src" / "db" / "data" / "bins.json"
OUT_VERIFY_MD = ROOT / "docs" / "bins-verification.md"

JOIN_TABLE = {
    "FLETCHER": None,
    "OCALLAGHAN": None,
    "YALE": "Yale/Keyes Senior Apts",
    "REID": "Sen. Harry Reid Senior Apts Aka 11Th St",
    "JUAN": "Juan Garcia Aka Ernie Cragin",
    "SRB": None,
    "LOUISE SHELL": "Louise Shell/Harmony Park Apts",
    "OWENS": "Owens Senior",
    "MEACHAM": "Dr. Paul Meacham",
    "SMITH WILLIAMS": "Smith Williams Apts",
    "MACK": None,
    "DONNALOUISE": None,
}


@dataclass
class PdfManifestEntry:
    slug: str
    pdf_path: Path
    page_pngs: list[Path]
    pages_in_pdf: int
    pages_in_header: int | None


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def discover_pdfs(pdf_dir: Path) -> list[Path]:
    pdfs = sorted([p for p in pdf_dir.glob("*.pdf") if "BIN" in p.name.upper()])
    if not pdfs:
        raise SystemExit(f"no *BIN*.pdf files in {pdf_dir}")
    return pdfs


def pages_reported_by_header(pdf_path: Path) -> int | None:
    """Some scans claim 'Page 1 of N' in the header but ship fewer images.
    We can't OCR the header here (we'd need vision), so leave the field for
    the agent to fill in. Returns None at this stage."""
    return None


def render_pdf(pdf_path: Path, out_dir: Path, dpi: int = 400, split: bool = True) -> PdfManifestEntry:
    """Rasterize each page; optionally split into top/bottom halves so the agent
    sees larger crops of dense rotated-landscape tables. The pages are printed
    sideways, so the PNG's vertical halves correspond to left/right halves of
    the underlying landscape report. Splitting roughly doubles the resolution
    the vision model has on column boundaries and handwriting strokes."""
    slug = slugify(pdf_path.stem.replace(" BIN", "").replace("BIN", ""))
    pdf_out = out_dir / slug
    pdf_out.mkdir(parents=True, exist_ok=True)

    with pdfplumber.open(pdf_path) as pdf:
        pages_in_pdf = len(pdf.pages)

    images = convert_from_path(str(pdf_path), dpi=dpi, fmt="png")
    page_pngs: list[Path] = []
    for i, img in enumerate(images, start=1):
        if not split:
            png = pdf_out / f"page-{i:02d}.png"
            img.save(png, "PNG", optimize=True)
            page_pngs.append(png)
            continue

        w, h = img.size
        # ~5% overlap between halves so rows split across the seam are still
        # readable in at least one crop.
        overlap = int(h * 0.05)
        mid = h // 2
        top = img.crop((0, 0, w, mid + overlap))
        bot = img.crop((0, mid - overlap, w, h))
        top_png = pdf_out / f"page-{i:02d}-a.png"
        bot_png = pdf_out / f"page-{i:02d}-b.png"
        top.save(top_png, "PNG", optimize=True)
        bot.save(bot_png, "PNG", optimize=True)
        page_pngs.extend([top_png, bot_png])

    return PdfManifestEntry(
        slug=slug,
        pdf_path=pdf_path,
        page_pngs=page_pngs,
        pages_in_pdf=pages_in_pdf,
        pages_in_header=pages_reported_by_header(pdf_path),
    )


def cmd_render(args: argparse.Namespace) -> None:
    pdf_dir = Path(args.pdf_dir).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "agent-out").mkdir(exist_ok=True)

    pdfs = discover_pdfs(pdf_dir)
    print(f"[render] found {len(pdfs)} PDFs in {pdf_dir}")
    manifest: list[dict] = []
    for pdf in pdfs:
        entry = render_pdf(pdf, out_dir, dpi=args.dpi, split=args.split)
        print(f"  {entry.slug:20s} {len(entry.page_pngs):>2d} pages -> {entry.page_pngs[0].parent}")
        manifest.append({
            "slug": entry.slug,
            "pdfName": pdf.name,
            "pdfPath": str(entry.pdf_path),
            "pages": [str(p) for p in entry.page_pngs],
            "pagesInPdf": entry.pages_in_pdf,
            "agentOutPath": str(out_dir / "agent-out" / f"{entry.slug}.json"),
        })

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"[render] manifest -> {manifest_path}")
    print(f"[render] next: dispatch one Opus agent per property; write each agent's")
    print(f"          JSON to {out_dir}/agent-out/<slug>.json then run `merge`.")


def load_agent_output(path: Path) -> dict:
    if not path.exists():
        return {
            "_missing": True,
            "buildings": [],
            "warnings": [f"agent output {path} missing"],
        }
    raw = path.read_text().strip()
    # tolerate agents that wrap output in ```json fences
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return json.loads(raw)


def normalize_property(slug: str, manifest_entry: dict, agent: dict) -> dict:
    pdf_name = manifest_entry["pdfName"]
    bare_key = pdf_name.upper().replace("BIN.PDF", "").replace(".PDF", "").strip()
    join_name = JOIN_TABLE.get(bare_key, agent.get("joinName"))

    buildings = []
    bin_re = re.compile(r"^NV-\d{2}-\d{5}$")
    for b in agent.get("buildings", []):
        units = list(b.get("units") or [])
        units.sort(key=lambda u: (
            int(u.split("-")[0]) if u.split("-")[0].isdigit() else 0,
            u,
        ))
        bin_val = b.get("bin")
        if bin_val and not bin_re.match(bin_val):
            agent.setdefault("warnings", []).append(
                f"building {b.get('buildingCode')} bin {bin_val!r} does not match NV-YY-NNNNN"
            )
        buildings.append({
            "buildingCode": str(b.get("buildingCode") or b.get("building") or ""),
            "bin": bin_val,
            "unitCount": len(units),
            "units": units,
        })
    buildings.sort(key=lambda b: (
        int(b["buildingCode"]) if b["buildingCode"].isdigit() else 999,
        b["buildingCode"],
    ))

    pages_in_pdf = manifest_entry["pagesInPdf"]
    pages_reported = agent.get("pagesReportedByHeader")
    scan_incomplete = (
        pages_reported is not None and pages_reported > pages_in_pdf
    )

    out = {
        "propertyName": agent.get("propertyName"),
        "operatorEntity": agent.get("operatorEntity"),
        "joinName": join_name,
        "source": {
            "type": "gpmg-email",
            "date": agent.get("sourceDate", "2026-05-27"),
            "pdf": pdf_name,
            "pagesScanned": pages_in_pdf,
            "pagesReportedByHeader": pages_reported,
            "scanIncomplete": scan_incomplete,
        },
        "buildings": buildings,
        "warnings": list(agent.get("warnings") or []),
    }
    if scan_incomplete:
        out["warnings"].insert(0, (
            f"PDF has {pages_in_pdf} pages but header reports {pages_reported}; "
            "additional buildings/units may be missing — request a full scan."
        ))
    if any(b["bin"] is None for b in buildings):
        out["warnings"].append("one or more buildings have no BIN extracted")
    if not buildings:
        out["warnings"].append("agent returned zero buildings")
    return out


def cmd_merge(args: argparse.Namespace) -> None:
    work_dir = Path(args.work_dir).expanduser().resolve()
    agent_dir = Path(args.agent_dir).expanduser().resolve()
    manifest = json.loads((work_dir / "manifest.json").read_text())

    # Defensive: a missing or empty agent output must never silently wipe a
    # property that was already extracted into bins.json. Load any prior result
    # and keep it whenever this run's agent file is absent or returned zero
    # buildings. (A re-run that genuinely re-extracts a property always wins.)
    prior: dict[str, dict] = {}
    if OUT_BINS_JSON.exists():
        try:
            prior = json.loads(OUT_BINS_JSON.read_text())
        except (json.JSONDecodeError, OSError):
            prior = {}

    bins: dict[str, dict] = {}
    summary_rows = []
    total_buildings = 0
    total_units = 0
    total_missing_bins = 0

    for entry in manifest:
        slug = entry["slug"]
        agent_json = load_agent_output(agent_dir / f"{slug}.json")
        prop = normalize_property(slug, entry, agent_json)
        if not prop["buildings"] and prior.get(slug, {}).get("buildings"):
            prop = prior[slug]
            prop.setdefault("warnings", []).append(
                "agent output missing/empty this run — preserved prior extraction"
            )
            print(f"[merge] {slug}: agent output empty, kept prior extraction")
        bins[slug] = prop
        b_count = len(prop["buildings"])
        u_count = sum(b["unitCount"] for b in prop["buildings"])
        missing = sum(1 for b in prop["buildings"] if not b["bin"])
        total_buildings += b_count
        total_units += u_count
        total_missing_bins += missing
        summary_rows.append((slug, prop, b_count, u_count, missing))

    OUT_BINS_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_BINS_JSON.write_text(json.dumps(bins, indent=2) + "\n")
    print(f"[merge] wrote {OUT_BINS_JSON.relative_to(ROOT)}")

    md = ["# BINs verification\n"]
    md.append("Source: 12-attachment email from Dora D. LaGrande (Global Property Management Group), 2026-05-27.\n")
    md.append(f"Summary: **{len(bins)} properties**, **{total_buildings} buildings**, **{total_units} units**, **{total_missing_bins} missing BINs**.\n")
    md.append("If `missing BINs > 0`, the agent could not read the handwritten BIN for one or more buildings — re-render at higher DPI or request a re-scan.\n")
    md.append("---\n")
    for slug, prop, b_count, u_count, missing in summary_rows:
        md.append(f"\n## {slug.upper()} — {prop.get('propertyName') or '(name not extracted)'}\n")
        md.append(f"- Operator entity: {prop.get('operatorEntity') or '(none)'}")
        src = prop["source"]
        md.append(f"- Source: `{src['pdf']}` (pages scanned: {src['pagesScanned']}, header reports: {src['pagesReportedByHeader']}, incomplete: {src['scanIncomplete']})")
        join = prop["joinName"]
        md.append(f"- Join to `nv-housing-props.json`: {('`' + join + '`') if join else '**no match** (new property or unmapped)'}")
        if prop["warnings"]:
            md.append("- Warnings:")
            for w in prop["warnings"]:
                md.append(f"  - ⚠ {w}")
        md.append("")
        md.append("| Building | BIN | Units | First | Last |")
        md.append("|---:|---|---:|---|---|")
        for b in prop["buildings"]:
            first = b["units"][0] if b["units"] else "—"
            last = b["units"][-1] if b["units"] else "—"
            bin_disp = b["bin"] or "**missing**"
            md.append(f"| {b['buildingCode']} | {bin_disp} | {b['unitCount']} | {first} | {last} |")
    OUT_VERIFY_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_VERIFY_MD.write_text("\n".join(md) + "\n")
    print(f"[merge] wrote {OUT_VERIFY_MD.relative_to(ROOT)}")
    print(f"[merge] totals: {len(bins)} properties / {total_buildings} bldgs / {total_units} units / {total_missing_bins} missing BINs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_render = sub.add_parser("render", help="rasterize PDFs and emit manifest")
    p_render.add_argument("--pdf-dir", required=True)
    p_render.add_argument("--out-dir", required=True)
    p_render.add_argument("--dpi", type=int, default=400)
    p_render.add_argument("--no-split", dest="split", action="store_false")
    p_render.set_defaults(split=True)
    p_render.set_defaults(func=cmd_render)

    p_merge = sub.add_parser("merge", help="combine agent JSON into bins.json + verification doc")
    p_merge.add_argument("--work-dir", required=True)
    p_merge.add_argument("--agent-dir", required=True)
    p_merge.set_defaults(func=cmd_merge)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
