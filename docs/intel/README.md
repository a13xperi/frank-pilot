# docs/intel

Competitive and operator intelligence artifacts for Frank-Pilot.

## Canonical artifacts (committed)

| File | Description |
|------|-------------|
| `gpmglv-audit.md` | Evidence-based tenant flow audit of gpmglv.com (2026-05-21) |
| `gpmglv-bp-03b-positioning.md` | BP-03b competitive positioning vs. GPMGLV |
| `gpmglv-gap-backlog.md` | Product gap backlog derived from the audit |

The `.md` files are the source of truth. They are synthesised from raw crawl data and are safe to commit, share, and diff.

## Raw scrape output (gitignored)

Raw HTML, headers, and extracted text live under `raw/gpmglv/<YYYY-MM-DD>/` and are **not committed** (see `.gitignore`). They are produced by the scrape script and intended for local diffing and archiving.

### Re-running the scrape

```bash
node scripts/scrape-gpmglv.mjs
```

Options:

| Flag | Description |
|------|-------------|
| `--max <n>` | Max pages to fetch (default 60) |
| `--delay <ms>` | Delay between requests in ms (default 300) |
| `--force` | Overwrite existing same-day output |
| `--dry-run` | Print seed URLs and output path — no network |

### Output layout

```
docs/intel/raw/gpmglv/YYYY-MM-DD/
  manifest.json              # array of fetch records (url, status, bytes, paths, …)
  errors.log                 # one line per failed fetch (if any)
  pages/
    index.html               # body of https://gpmglv.com/
    index.headers.json       # response headers
    index.txt                # plain text (scripts/styles stripped, whitespace collapsed)
    properties.html
    properties.headers.json
    properties.txt
    … one triplet per page …
```

### Diffing across runs

```bash
diff docs/intel/raw/gpmglv/2026-05-21/pages/index.txt \
     docs/intel/raw/gpmglv/2026-05-28/pages/index.txt
```

Or diff the whole `pages/` tree:

```bash
diff -rq docs/intel/raw/gpmglv/2026-05-21/pages \
          docs/intel/raw/gpmglv/2026-05-28/pages
```
