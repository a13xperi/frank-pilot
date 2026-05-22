#!/usr/bin/env node
/**
 * scrape-gpmglv.mjs
 *
 * Polite, dependency-free scraper for gpmglv.com (a small Las Vegas
 * affordable-housing operator's public marketing site). Output goes to
 * docs/intel/raw/gpmglv/<YYYY-MM-DD>/ as raw HTML + an image catalog.
 *
 * Usage:
 *   node scripts/scrape-gpmglv.mjs [--force] [--page=/url] [--dry-run]
 *                                  [--no-images] [--limit=N]
 *
 * Exit codes:
 *   0 success, 1 partial (some URLs failed), 2 abort (too many 5xx)
 */

import { mkdir, writeFile, readFile, access, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BASE = 'https://gpmglv.com';
const UA = 'frank-pilot-scrape/1.0 (+contact: alex.e.peri@gmail.com)';
const REQUEST_DELAY_MS = 500;
const RETRY_BACKOFF_MS = 2000;
const MAX_CONSECUTIVE_5XX = 3;
const MAX_PAGES_DEFAULT = 80;
const SKIP_REGEXES = [
  /\/login(\/|$)/,
  /\/_next\//,
  /\/css\//,
  /\/fonts\//,
  /\/brand\//, // logo SVG, not a content page
  /\/uploads\//, // gallery images — handled by image extractor, not the page queue
  /\.(css|js|woff2?|ico|map|xml|txt|svg|png|jpe?g|webp|gif|pdf)(\?|$)/i,
];

// ---------- CLI ----------
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const NO_IMAGES = args.includes('--no-images');
const PAGE_ARG = args.find((a) => a.startsWith('--page='))?.split('=')[1];
const LIMIT = (() => {
  const a = args.find((x) => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : MAX_PAGES_DEFAULT;
})();

// ---------- Seed URLs ----------
const PROPERTY_SLUGS = [
  'aldene-kline-barlow-senior-community',
  'david-j-hoggard-family-community',
  'donna-louise-apartments',
  'donna-louise-2-apartments',
  'dr-luther-mack-jr-senior-community',
  'dr-paul-meacham-senior-community',
  'ethel-mae-fletcher-apartments',
  'ethel-mae-robinson-senior-apartments',
  'governor-mike-ocallaghan-apartments',
  'juan-garcia-garden-apartments',
  'louise-shell-senior-apartments',
  'owens-senior-housing',
  'sarann-knight-apartments',
  'senator-harry-reid-senior-apartments',
  'senator-richard-bryan-senior-apartments',
  'smith-williams-senior-apartments',
  'yale-keyes-senior-apartments',
];

const SEED_URLS = [
  '/',
  '/about-us',
  '/properties',
  '/contact-us',
  '/join-waitlist',
  '/apply',
  '/available',
  '/resources',
  '/privacy-policy',
  '/terms-and-conditions',
  '/portal',
  '/portal/lookup',
  '/portal/maintenance',
  '/portal/contact-management',
  ...PROPERTY_SLUGS.map((s) => `/homes/${s}`),
];

// ---------- Output paths ----------
const TODAY = new Date().toISOString().slice(0, 10);
const OUT_ROOT = path.join(ROOT, 'docs', 'intel', 'raw', 'gpmglv', TODAY);
const PAGES_DIR = path.join(OUT_ROOT, 'pages');
const IMAGES_DIR = path.join(OUT_ROOT, 'images');
const MANIFEST_PATH = path.join(OUT_ROOT, 'manifest.json');
const IMAGES_MANIFEST_PATH = path.join(OUT_ROOT, 'images-manifest.json');

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pathFromUrl(url) {
  const u = new URL(url);
  let p = u.pathname.replace(/^\/+/, '');
  if (!p) p = 'index';
  // strip trailing slash
  p = p.replace(/\/+$/, '');
  return p + '.html';
}

function shouldSkip(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'gpmglv.com' && u.hostname !== 'www.gpmglv.com') return true;
    if (u.search && u.search.length > 100) return true;
    if (SKIP_REGEXES.some((rx) => rx.test(u.pathname + u.search))) return true;
    return false;
  } catch {
    return true;
  }
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

async function ensureDir(d) {
  await mkdir(d, { recursive: true });
}

async function readJSONSafe(p) {
  try {
    const txt = await readFile(p, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

// ---------- Fetch with retry + conditional ----------
async function fetchOnce(url, { etag, lastModified } = {}) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const start = Date.now();
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    return { ok: false, networkError: e.message, status: 0, ms: Date.now() - start };
  }
  const ms = Date.now() - start;

  if (res.status === 304) {
    return {
      ok: true,
      status: 304,
      ms,
      etag,
      lastModified,
      contentType: res.headers.get('content-type') || '',
      body: null,
    };
  }

  const ct = res.headers.get('content-type') || '';
  // For images we want a buffer; for HTML, text
  let body;
  if (ct.startsWith('image/')) {
    const ab = await res.arrayBuffer();
    body = Buffer.from(ab);
  } else {
    body = await res.text();
  }

  return {
    ok: res.ok,
    status: res.status,
    ms,
    etag: res.headers.get('etag') || null,
    lastModified: res.headers.get('last-modified') || null,
    contentType: ct,
    body,
  };
}

async function fetchPolite(url, prior = {}) {
  let attempt = 0;
  while (true) {
    const r = await fetchOnce(url, prior);
    if (r.networkError) {
      if (attempt < 1) {
        attempt++;
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      return r;
    }
    if (r.status >= 500 && r.status < 600 && attempt < 1) {
      attempt++;
      await sleep(RETRY_BACKOFF_MS);
      continue;
    }
    return r;
  }
}

// ---------- Link discovery ----------
function extractLinks(html, fromUrl) {
  const out = new Set();
  // href="..." or href='...'
  const re = /href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] || m[2] || '').trim();
    if (!raw) continue;
    if (raw.startsWith('#')) continue;
    if (raw.startsWith('mailto:')) continue;
    if (raw.startsWith('tel:')) continue;
    if (raw.startsWith('javascript:')) continue;
    try {
      const u = new URL(raw, fromUrl);
      // Normalize: drop fragment, drop "property" query (waitlist deeplinks all
      // resolve to the same page) — keep other queries intact.
      u.hash = '';
      if (u.pathname === '/join-waitlist') u.search = '';
      const abs = u.toString();
      if (!shouldSkip(abs)) out.add(abs);
    } catch {
      // ignore
    }
  }
  return [...out];
}

function extractImageUrls(html, fromUrl) {
  const out = [];
  // src="..." or src='...'
  const re = /<img\b[^>]*?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const srcMatch = tag.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const altMatch = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const src = srcMatch ? srcMatch[1] || srcMatch[2] : null;
    const alt = altMatch ? altMatch[1] || altMatch[2] : '';
    if (!src) continue;
    if (src.startsWith('data:')) continue;
    try {
      const abs = new URL(src, fromUrl).toString();
      // Same-domain images only (skip third-party CDNs to stay polite & relevant)
      const u = new URL(abs);
      if (u.hostname !== 'gpmglv.com' && u.hostname !== 'www.gpmglv.com') continue;
      // Skip Next.js image-optimization endpoint underlying source if we can detect; just dedupe later
      out.push({ url: abs, alt, sourceTag: tag });
    } catch {
      // ignore
    }
  }
  // Also catch <source srcset="..."> and og:image
  const ogRe = /<meta\b[^>]*?property\s*=\s*["']og:image["'][^>]*?>/gi;
  while ((m = ogRe.exec(html)) !== null) {
    const tag = m[0];
    const c = tag.match(/\bcontent\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const src = c ? c[1] || c[2] : null;
    if (!src) continue;
    try {
      const abs = new URL(src, fromUrl).toString();
      const u = new URL(abs);
      if (u.hostname === 'gpmglv.com' || u.hostname === 'www.gpmglv.com') {
        out.push({ url: abs, alt: 'og:image', sourceTag: tag });
      }
    } catch {
      // ignore
    }
  }
  return out;
}

// ---------- Main ----------
async function main() {
  console.log(`[scrape-gpmglv] base=${BASE} day=${TODAY} limit=${LIMIT}`);
  console.log(`[scrape-gpmglv] flags: force=${FORCE} dry=${DRY_RUN} noImages=${NO_IMAGES} page=${PAGE_ARG || '(all)'}`);

  await ensureDir(PAGES_DIR);
  if (!NO_IMAGES) await ensureDir(IMAGES_DIR);

  // Load prior manifest (if any) for conditional fetch
  const priorManifest = (await readJSONSafe(MANIFEST_PATH)) || [];
  const priorByUrl = Object.fromEntries(priorManifest.map((m) => [m.url, m]));

  const imagesManifest = (await readJSONSafe(IMAGES_MANIFEST_PATH)) || [];
  const imagesSeen = new Set(imagesManifest.map((i) => i.url));

  // Build queue
  let queue;
  if (PAGE_ARG) {
    queue = [new URL(PAGE_ARG, BASE).toString()];
  } else {
    queue = SEED_URLS.map((p) => new URL(p, BASE).toString());
  }

  const fetched = new Set();
  const newManifest = [];
  let failures = 0;
  let consecutive5xx = 0;
  let totalImages = 0;
  let imageFailures = 0;

  while (queue.length > 0 && fetched.size < LIMIT) {
    const url = queue.shift();
    if (fetched.has(url)) continue;
    if (shouldSkip(url)) continue;
    fetched.add(url);

    const relPath = pathFromUrl(url);
    const filePath = path.join(PAGES_DIR, relPath);
    const prior = priorByUrl[url];

    // Idempotency: if file exists and not --force, skip (but still record)
    if (!FORCE && existsSync(filePath)) {
      const st = await stat(filePath);
      const body = await readFile(filePath, 'utf8');
      const entry = {
        url,
        status: prior?.status || 200,
        bytes: st.size,
        etag: prior?.etag || null,
        last_modified: prior?.last_modified || null,
        fetched_at: prior?.fetched_at || new Date().toISOString(),
        sha256: sha256(body),
        content_type: prior?.content_type || 'text/html',
        cached: true,
      };
      newManifest.push(entry);
      console.log(`SKIP ${new URL(url).pathname} → cached ${st.size}b`);
      // Still discover links from cached content
      if (!PAGE_ARG) {
        for (const link of extractLinks(body, url)) {
          if (!fetched.has(link) && !queue.includes(link)) queue.push(link);
        }
      }
      continue;
    }

    if (DRY_RUN) {
      console.log(`DRY  ${new URL(url).pathname}`);
      newManifest.push({ url, status: 0, bytes: 0, dry_run: true });
      continue;
    }

    await sleep(REQUEST_DELAY_MS);
    const r = await fetchPolite(url, {
      etag: prior?.etag,
      lastModified: prior?.last_modified,
    });

    if (r.networkError) {
      console.log(`ERR  ${new URL(url).pathname} → NETWORK ${r.networkError} ${r.ms}ms`);
      failures++;
      newManifest.push({ url, status: 0, bytes: 0, error: r.networkError });
      continue;
    }

    if (r.status === 304) {
      console.log(`304  ${new URL(url).pathname} → ${r.ms}ms (still fresh)`);
      const st = existsSync(filePath) ? await stat(filePath) : { size: 0 };
      newManifest.push({
        url,
        status: 304,
        bytes: st.size,
        etag: r.etag,
        last_modified: r.lastModified,
        fetched_at: new Date().toISOString(),
        sha256: prior?.sha256 || null,
        content_type: r.contentType,
      });
      // Discover links from cached
      if (existsSync(filePath) && !PAGE_ARG) {
        const body = await readFile(filePath, 'utf8');
        for (const link of extractLinks(body, url)) {
          if (!fetched.has(link) && !queue.includes(link)) queue.push(link);
        }
      }
      consecutive5xx = 0;
      continue;
    }

    console.log(`GET  ${new URL(url).pathname} → ${r.status} ${(r.body?.length || 0)}b ${r.ms}ms`);

    if (r.status >= 500) {
      consecutive5xx++;
      failures++;
      newManifest.push({ url, status: r.status, bytes: 0, error: `HTTP ${r.status}` });
      if (consecutive5xx >= MAX_CONSECUTIVE_5XX) {
        console.error(`[abort] ${MAX_CONSECUTIVE_5XX} consecutive 5xx — treat as "they noticed", stopping.`);
        process.exit(2);
      }
      continue;
    }
    consecutive5xx = 0;

    if (r.status === 404 || r.status === 410) {
      newManifest.push({
        url,
        status: r.status,
        bytes: 0,
        fetched_at: new Date().toISOString(),
      });
      continue;
    }

    if (r.status >= 400) {
      failures++;
      newManifest.push({
        url,
        status: r.status,
        bytes: r.body?.length || 0,
        error: `HTTP ${r.status}`,
        fetched_at: new Date().toISOString(),
      });
      continue;
    }

    // 2xx HTML
    const body = typeof r.body === 'string' ? r.body : r.body.toString('utf8');
    await ensureDir(path.dirname(filePath));
    await writeFile(filePath, body, 'utf8');
    newManifest.push({
      url,
      status: r.status,
      bytes: body.length,
      etag: r.etag,
      last_modified: r.lastModified,
      fetched_at: new Date().toISOString(),
      sha256: sha256(body),
      content_type: r.contentType,
    });

    // Discover links (only when crawling broadly)
    if (!PAGE_ARG) {
      for (const link of extractLinks(body, url)) {
        if (!fetched.has(link) && !queue.includes(link)) queue.push(link);
      }
    }

    // Extract & download images
    if (!NO_IMAGES && r.contentType.includes('html')) {
      const imgs = extractImageUrls(body, url);
      for (const img of imgs) {
        if (imagesSeen.has(img.url)) continue;
        imagesSeen.add(img.url);
        await sleep(REQUEST_DELAY_MS);
        const ir = await fetchPolite(img.url);
        if (!ir.ok || ir.status >= 400 || !ir.body) {
          console.log(`IMG  ERR ${img.url} → ${ir.status || ir.networkError}`);
          imageFailures++;
          continue;
        }
        const urlHash = sha256(img.url).slice(0, 16);
        const ext = (() => {
          const ct = ir.contentType || '';
          if (ct.includes('jpeg')) return 'jpg';
          if (ct.includes('png')) return 'png';
          if (ct.includes('webp')) return 'webp';
          if (ct.includes('gif')) return 'gif';
          if (ct.includes('svg')) return 'svg';
          const m = img.url.match(/\.(jpe?g|png|webp|gif|svg)(\?|$)/i);
          return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'bin';
        })();
        const localName = `${urlHash}.${ext}`;
        const localPath = path.join(IMAGES_DIR, localName);
        await writeFile(localPath, ir.body);
        totalImages++;
        imagesManifest.push({
          url: img.url,
          local_path: path.relative(ROOT, localPath),
          sha256: sha256(ir.body),
          bytes: ir.body.length,
          content_type: ir.contentType,
          alt_text: img.alt,
          source_page: url,
          fetched_at: new Date().toISOString(),
        });
      }
    }
  }

  // Write manifests
  await writeFile(MANIFEST_PATH, JSON.stringify(newManifest, null, 2));
  if (!NO_IMAGES) {
    await writeFile(IMAGES_MANIFEST_PATH, JSON.stringify(imagesManifest, null, 2));
  }

  // README in images dir
  if (!NO_IMAGES) {
    const readme = `# gpmglv image cache

These images were downloaded from https://gpmglv.com for INTERNAL competitive
research and product-design reference only. They are property of their respective
copyright holders.

Do NOT redistribute, republish, or use these images on any Frank-Pilot surface
(public or private) without explicit licensing review by a human.

Each file is named <sha256(url).first16>.<ext> to prevent duplicates.

Source map: ../images-manifest.json
`;
    await writeFile(path.join(IMAGES_DIR, 'README.md'), readme);
  }

  // Summary block
  const summary = {
    base: BASE,
    day: TODAY,
    pages_fetched: fetched.size,
    pages_in_manifest: newManifest.length,
    failures,
    images_downloaded: totalImages,
    image_failures: imageFailures,
    output_dir: path.relative(ROOT, OUT_ROOT),
  };
  console.log('\n[scrape-gpmglv] summary:');
  console.log(JSON.stringify(summary, null, 2));

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[scrape-gpmglv] fatal:', e);
  process.exit(2);
});
