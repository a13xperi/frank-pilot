#!/usr/bin/env node
/**
 * build-deal-corpus.mjs — package the curated deal docs into a committed JSON
 * corpus for the hosted Deal-Room Q&A bot (src/db/data/deal-corpus.json).
 *
 * A Node port of battlestation scripts/dealroom-feed.py: it reads the SAME
 * curated, compartment-safe asset set the local deal bot grounds against
 * (the partner visit-pack + the Stack/investor/energy whitepapers — deliberately
 * NOT the cap table, financial model, CRAIG-*, or privileged docs), chunks each
 * by markdown heading into ≤1100-char windows, and emits a { entries: [...] }
 * file that src/modules/deal-qa/corpus.ts reads at runtime.
 *
 * Runs ON THE MAC (Railway can't reach battlestation); the JSON is committed so
 * the hosted retriever is fully self-contained. Idempotent: rebuilds in full.
 *
 * Usage:
 *   node scripts/build-deal-corpus.mjs                 # default curated set
 *   BATTLESTATION_DIR=/path node scripts/build-deal-corpus.mjs
 *   node scripts/build-deal-corpus.mjs /abs/doc.md ... # specific files
 *
 * The masking guard + privileged floor are the BACKSTOP; this curation is the
 * real wall — keep cap-table / raw-economics / internal-name docs OUT of the set.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "src", "db", "data", "deal-corpus.json");

// Source repo (absolute — do NOT walk up for .git; worktrees have .git-as-a-file).
const BS = process.env.BATTLESTATION_DIR || "/Users/A13xPeri/code/battlestation";

const CHUNK_MAX = 1100; // chars per chunk (keeps a passage focused for IDF retrieval)

function sha1(s) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

// The curated, compartment-safe asset set — mirrors dealroom-feed.py _CURATED.
function curatedAssets() {
  const visitPack = path.join(BS, "docs", "dossiers", "slater-visit-pack");
  let packFiles = [];
  try {
    packFiles = fs
      .readdirSync(visitPack)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => path.join(visitPack, f));
  } catch {
    /* visit pack missing — fine, the rest still feed */
  }
  const rel = (...p) => path.join(BS, ...p);
  return [
    ...packFiles,
    rel("docs", "STACK-MODEL.md"),
    rel("docs", "STACK-SEATS.md"),
    rel("docs", "deals", "30000-FT-VIEW.md"),
    rel("docs", "deals", "THE-DEAL-FOR-FRANK.md"),
    rel("docs", "deals", "STACK-WORKING-BRIEF.md"),
    rel("docs", "deals", "WHITE-PAPER-v0-INVESTOR.md"),
    rel("docs", "deals", "WHITE-PAPER-BLUEPRINT.md"),
    rel("docs", "energy", "ENERGY-CREDITS-PLAY-WHITEPAPER.md"),
    rel("docs", "energy", "ENERGY-PLAY.md"),
    rel("docs", "energy", "01-credit-stack.md"),
    rel("docs", "energy", "48e-aggregation-analysis.md"),
    rel("docs", "energy", "ENERGY-CREDITS-RISK-MITIGATION.md"),
  ];
}

// Split on markdown headings, then pack into ≤CHUNK_MAX windows, carrying the
// nearest heading as the chunk's title (port of dealroom-feed.py _chunks).
function chunks(text) {
  let title = "";
  let buf = [];
  const out = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) out.push({ title, body });
  };
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) {
      flush();
      buf = [];
      title = line.replace(/^[#\s]+/, "").trim();
      continue;
    }
    buf.push(line);
    if (buf.reduce((n, b) => n + b.length, 0) >= CHUNK_MAX) {
      flush();
      buf = [];
    }
  }
  flush();
  return out;
}

function build(paths) {
  const rows = [];
  const seen = new Set();
  let nFiles = 0;
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      console.error(`  skip (missing): ${p}`);
      continue;
    }
    nFiles += 1;
    const name = path.basename(p);
    const stem = name.replace(/\.[^.]+$/, "");
    const text = fs.readFileSync(p, "utf8");
    chunks(text).forEach(({ title, body }, i) => {
      const sref = `${name}#${i}:` + sha1(body).slice(0, 10);
      if (seen.has(sref)) return;
      seen.add(sref);
      rows.push({
        id: "dr-" + sha1(sref).slice(0, 12),
        source_ref: sref,
        audience: "operator", // operator = served (the bot floors masking anyway)
        status: "approved",
        section: title || stem,
        question: title || stem, // heading carries 3x retrieval weight
        answer: body,
        source: `dealroom:${name}`,
      });
    });
  }
  return { rows, nFiles };
}

const args = process.argv.slice(2);
const assets = args.length ? args.map((a) => path.resolve(a)) : curatedAssets();
const { rows, nFiles } = build(assets);
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify({ entries: rows }, null, 2) + "\n");
console.log(
  `[build-deal-corpus] ${rows.length} chunk(s) from ${nFiles} file(s) → ${path.relative(REPO_ROOT, OUT_PATH)}`
);
