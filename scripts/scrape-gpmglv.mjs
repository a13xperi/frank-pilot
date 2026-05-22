#!/usr/bin/env node
/**
 * scrape-gpmglv.mjs — reproducible crawler for gpmglv.com
 *
 * Usage:
 *   node scripts/scrape-gpmglv.mjs
 *   node scripts/scrape-gpmglv.mjs --max 10 --delay 500
 *   node scripts/scrape-gpmglv.mjs --force          # overwrite same-day output
 *   node scripts/scrape-gpmglv.mjs --dry-run        # print seeds + output path, no network
 *
 * Output: docs/intel/raw/gpmglv/YYYY-MM-DD/
 */

import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------
const BASE_URL = 'https://gpmglv.com';
const USER_AGENT =
  'frank-pilot-audit/1.0 (https://github.com/a13xperi/frank-pilot; analysis only)';
const DEFAULT_MAX_PAGES = 60;
const DEFAULT_DELAY_MS = 300;

// ---------------------------------------------------------------------------
// Seed URLs (derived from docs/intel/gpmglv-audit.md crawl log)
// ---------------------------------------------------------------------------
const SEED_PATHS = [
  '/',
  '/properties',
  '/contact-us',
  '/portal',
  '/portal/lookup',
  '/portal/maintenance',
  '/portal/contact-management',
  '/join-waitlist',
  '/about-us',
  '/privacy-policy',
  '/terms-and-conditions',
  '/resources',
  '/login',
  // The 17 community pages (16 confirmed 200, 1 flagged as possible 404)
  '/homes/aldene-kline-barlow-senior-community',
  '/homes/david-j-hoggard-family-community',
  '/homes/donna-louise-apartments',
  '/homes/donna-louise-2-apartments',
  '/homes/dr-luther-mack-jr-senior-community',
  '/homes/dr-paul-meacham-senior-community',
  '/homes/ethel-mae-robinson-senior-apartments',
  '/homes/ethel-mae-fletcher-apartments',
  '/homes/governor-mike-ocallaghan-apartments', // 404'd in original audit — included to track
  '/homes/juan-garcia-garden-apartments',
  '/homes/louise-shell-senior-apartments',
  '/homes/owens-senior-housing',
  '/homes/sarann-knight-apartments',
  '/homes/senator-harry-reid-senior-apartments',
  '/homes/senator-richard-bryan-senior-apartments',
  '/homes/smith-williams-senior-apartments',
  '/homes/yale-keyes-senior-apartments',
];

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { maxPages: DEFAULT_MAX_PAGES, delayMs: DEFAULT_DELAY_MS, force: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--max' && argv[i + 1]) { args.maxPages = parseInt(argv[++i], 10); }
    else if (a === '--delay' && argv[i + 1]) { args.delayMs = parseInt(argv[++i], 10); }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function outputDir(date) {
  return join(REPO_ROOT, 'docs', 'intel', 'raw', 'gpmglv', date);
}

/**
 * Turn a URL path into a safe filename slug.
 * /  → index
 * /homes/foo → homes_foo
 * /a?b=c → a__b=c
 */
function pathToSlug(urlPath) {
  if (!urlPath || urlPath === '/') return 'index';
  return urlPath
    .replace(/^\//, '')          // strip leading slash
    .replace(/\//g, '_')         // / → _
    .replace(/\?/g, '__')        // ? → __
    .replace(/[^a-zA-Z0-9_=.-]/g, '-'); // anything else → dash
}

// ---------------------------------------------------------------------------
// robots.txt parsing
// ---------------------------------------------------------------------------
async function fetchDisallowList() {
  const robotsUrl = `${BASE_URL}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`  robots.txt → ${res.status} (no restrictions applied)`);
      return [];
    }
    const text = await res.text();
    const disallowed = [];
    let inUserAgentBlock = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed)) { inUserAgentBlock = true; continue; }
      if (/^user-agent:/i.test(trimmed)) { inUserAgentBlock = false; continue; }
      if (inUserAgentBlock && /^disallow:/i.test(trimmed)) {
        const path = trimmed.replace(/^disallow:\s*/i, '').trim();
        if (path) disallowed.push(path);
      }
    }
    console.log(`  robots.txt → 200; disallowed paths: ${disallowed.length || 'none'}`);
    return disallowed;
  } catch (err) {
    console.warn(`  robots.txt fetch failed: ${err.message} — proceeding without restriction`);
    return [];
  }
}

function isDisallowed(urlPath, disallowList) {
  return disallowList.some((d) => urlPath.startsWith(d));
}

// ---------------------------------------------------------------------------
// Link extraction (regex, no cheerio)
// ---------------------------------------------------------------------------
function extractLinks(html, baseUrl) {
  const links = new Set();
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    // Skip fragments, mailto, tel, javascript
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') ||
        raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;

    let resolved;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      continue;
    }

    // Strip fragment
    resolved.hash = '';
    const href = resolved.href;

    // Only same origin
    if (resolved.origin !== new URL(baseUrl).origin) continue;
    links.add(href);
  }
  return [...links];
}

// ---------------------------------------------------------------------------
// Plain-text extraction (strip script/style, collapse whitespace)
// ---------------------------------------------------------------------------
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const date = todayStr();
  const outDir = outputDir(date);
  const pagesDir = join(outDir, 'pages');

  console.log('\n=== gpmglv.com scraper ===');
  console.log(`Date:       ${date}`);
  console.log(`Output:     ${outDir}`);
  console.log(`Max pages:  ${args.maxPages}`);
  console.log(`Delay:      ${args.delayMs} ms`);
  console.log(`Seeds:      ${SEED_PATHS.length} hard-coded`);

  if (args.dryRun) {
    console.log('\n-- DRY RUN: seed URLs --');
    SEED_PATHS.forEach((p) => console.log(`  ${BASE_URL}${p}`));
    console.log(`\nOutput dir would be: ${outDir}`);
    console.log('No network requests made.\n');
    process.exit(0);
  }

  // Idempotency check
  const manifestPath = join(outDir, 'manifest.json');
  if (existsSync(manifestPath) && !args.force) {
    console.error(
      `\nERROR: ${manifestPath} already exists.\n` +
      `Same-day re-runs would silently overwrite findings. Pass --force to override.\n`
    );
    process.exit(1);
  }
  if (existsSync(outDir) && args.force) {
    console.log('--force: removing existing day directory...');
    await rm(outDir, { recursive: true });
  }
  await mkdir(pagesDir, { recursive: true });

  // errors log handle (write-append via array, flush at end)
  const errorLines = [];
  function logError(url, status, msg) {
    errorLines.push(`[${new Date().toISOString()}] ${status} ${url} — ${msg}`);
    console.warn(`  ERROR ${status} ${url}: ${msg}`);
  }

  // Fetch robots.txt
  console.log('\nFetching robots.txt...');
  const disallowList = await fetchDisallowList();

  // Queue initialisation
  const queue = [];
  const queued = new Set();
  const manifest = [];
  let fetchedCount = 0;
  let errorCount = 0;
  let totalBytes = 0;

  function enqueue(urlStr, discoveredFrom) {
    if (queued.has(urlStr)) return;
    const parsed = new URL(urlStr);
    if (isDisallowed(parsed.pathname, disallowList)) {
      console.log(`  SKIP (robots.txt disallow) ${urlStr}`);
      return;
    }
    queued.add(urlStr);
    queue.push({ url: urlStr, discoveredFrom });
  }

  // Seed
  SEED_PATHS.forEach((p) => enqueue(`${BASE_URL}${p}`, 'seed'));

  console.log('\nStarting crawl...\n');

  let qi = 0; // queue index (we grow the queue as we crawl)
  while (qi < queue.length && fetchedCount < args.maxPages) {
    const { url, discoveredFrom } = queue[qi++];
    const parsed = new URL(url);
    const slug = pathToSlug(parsed.pathname + (parsed.search || ''));
    const bodyFile = `pages/${slug}.html`;
    const headersFile = `pages/${slug}.headers.json`;
    const textFile = `pages/${slug}.txt`;

    console.log(`[${fetchedCount + 1}/${args.maxPages}] GET ${url}`);

    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      logError(url, 0, err.message);
      errorCount++;
      errorLines.push(`[${new Date().toISOString()}] NETWORK_ERROR ${url} — ${err.message}`);
      await sleep(args.delayMs);
      continue;
    }

    const status = res.status;
    const contentType = res.headers.get('content-type') || '';
    const fetchedAt = new Date().toISOString();

    // Save headers regardless of content type
    const headersObj = {};
    for (const [k, v] of res.headers.entries()) headersObj[k] = v;
    await writeFile(join(outDir, headersFile), JSON.stringify(headersObj, null, 2));

    // Stop on 429 or 5xx
    if (status === 429) {
      console.error(`\nWARN: HTTP 429 (rate-limited) on ${url}. Stopping.\nRe-run later with --delay ${args.delayMs * 2} or higher.\n`);
      logError(url, status, 'rate-limited, crawl aborted');
      break;
    }
    if (status >= 500) {
      console.warn(`WARN: HTTP ${status} on ${url}. Stopping to avoid hammering a troubled server.`);
      logError(url, status, `server error, crawl aborted`);
      break;
    }

    let bodyText = '';
    let extractedText = '';
    let bytes = 0;

    if (contentType.includes('text/html')) {
      bodyText = await res.text();
      bytes = Buffer.byteLength(bodyText, 'utf8');
      await writeFile(join(outDir, bodyFile), bodyText);
      extractedText = extractText(bodyText);
      await writeFile(join(outDir, textFile), extractedText);

      // Discover new links (only if not at cap)
      if (fetchedCount + 1 < args.maxPages) {
        const found = extractLinks(bodyText, url);
        let newCount = 0;
        for (const link of found) {
          enqueue(link, url);
          newCount++;
        }
        if (newCount > 0) console.log(`  → discovered ${found.length} links, ${queue.length - qi} queued`);
      }
    } else {
      // Non-HTML: consume body minimally for byte count, don't save
      const buf = await res.arrayBuffer();
      bytes = buf.byteLength;
      console.log(`  → skipping body (content-type: ${contentType})`);
      bodyFile && null; // placeholder — no body written
    }

    totalBytes += bytes;
    fetchedCount++;

    manifest.push({
      url,
      path: parsed.pathname + (parsed.search || ''),
      status,
      contentType: contentType.split(';')[0].trim(),
      bytes,
      fetchedAt,
      headersFile,
      bodyFile: contentType.includes('text/html') ? bodyFile : null,
      textFile: contentType.includes('text/html') ? textFile : null,
      discoveredFrom,
    });

    if (status >= 400) {
      logError(url, status, `HTTP ${status}`);
      errorCount++;
    }

    if (qi < queue.length && fetchedCount < args.maxPages) {
      await sleep(args.delayMs);
    }
  }

  // Write manifest
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Write errors log
  if (errorLines.length > 0) {
    await writeFile(join(outDir, 'errors.log'), errorLines.join('\n') + '\n');
  }

  // Summary
  const kb = (totalBytes / 1024).toFixed(1);
  console.log('\n=== Done ===');
  console.log(`Pages fetched:  ${fetchedCount}`);
  console.log(`Errors:         ${errorCount}`);
  console.log(`Total bytes:    ${kb} KB`);
  console.log(`Output:         ${outDir}`);
  console.log(`\nTo archive: git add ${outDir.replace(REPO_ROOT + '/', '')}`);
  console.log('(note: docs/intel/raw/gpmglv/ is gitignored — add --force if you want to commit raw artifacts)\n');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
