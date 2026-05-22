/**
 * wedge #14 — sitemap.xml build-time generator.
 *
 * Reads the canonical GPMG property fixtures from
 *   ../src/api/gpmg-fixtures.ts
 * and emits a sitemap covering:
 *   - /              (Welcome)               priority 1.0, monthly
 *   - /discover      (browse)                priority 0.9, daily
 *   - /discover/{slug} for every property    priority 0.8, daily
 *   - /apply                                 priority 0.5, monthly
 *
 * Wired into the `build` npm script so the file regenerates pre-`vite build`.
 * The output is also committed to the repo so `public/sitemap.xml` exists at
 * HEAD (Vercel serves `public/` even on first deploy).
 *
 * Host: read from the VITE_PUBLIC_SITE_URL environment variable at generation
 * time; falls back to https://frank-pilot-tenant.vercel.app when the variable
 * is not set (e.g. local dev, CI environments that don't inject it). Set
 * VITE_PUBLIC_SITE_URL in your Vercel project environment variables to
 * override for any deployment target.
 *
 * Node-version note: CI runs node 18/20/22. We avoid Node TS-strip features
 * (only available 22.6+ and behind a flag) by using esbuild's programmatic
 * transform to compile the TS fixture source to JS in-process. esbuild is a
 * transitive dependency of vite and is therefore always installed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'src', 'api', 'gpmg-fixtures.ts');
const OUTPUT_PATH = path.join(ROOT, 'public', 'sitemap.xml');

const SITE_URL = process.env.VITE_PUBLIC_SITE_URL || 'https://frank-pilot-tenant.vercel.app';

const ROUTES = [
  { loc: '/', changefreq: 'monthly', priority: '1.0' },
  { loc: '/discover', changefreq: 'daily', priority: '0.9' },
  { loc: '/apply', changefreq: 'monthly', priority: '0.5' },
];

const PROPERTY_PRIORITY = '0.8';
const PROPERTY_CHANGEFREQ = 'daily';

/**
 * Load `GPMG_FIXTURES` + `slugify` from the canonical TS source by
 * transpiling it through esbuild into a temp ESM module, then dynamically
 * importing it.
 */
async function loadFixtureExports() {
  // Defer esbuild import until actually generating — keeps the module
  // safe to import from a vitest (jsdom) test context that doesn't ship
  // the TextEncoder/Uint8Array shape esbuild requires.
  const esbuild = await import('esbuild');
  const src = await fs.readFile(FIXTURE_PATH, 'utf8');
  const { code } = await esbuild.transform(src, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sitemap-fixture-'));
  const tmpFile = path.join(tmpDir, 'gpmg-fixtures.mjs');
  await fs.writeFile(tmpFile, code, 'utf8');

  try {
    const mod = await import(pathToFileURL(tmpFile).href);
    const fixtures = mod.GPMG_FIXTURES;
    const slugify = mod.slugify;
    if (!Array.isArray(fixtures) || typeof slugify !== 'function') {
      throw new Error(
        `gpmg-fixtures.ts is missing expected exports (GPMG_FIXTURES, slugify)`
      );
    }
    return { fixtures, slugify };
  } finally {
    // Best-effort cleanup; not fatal if it fails.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlBlock({ loc, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

export function buildSitemapXml({ fixtures, slugify, siteUrl, lastmod }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for (const route of ROUTES) {
    lines.push(
      urlBlock({
        loc: `${siteUrl}${route.loc}`,
        lastmod,
        changefreq: route.changefreq,
        priority: route.priority,
      })
    );
  }

  for (const p of fixtures) {
    const slug = slugify(p.name);
    lines.push(
      urlBlock({
        loc: `${siteUrl}/discover/${slug}`,
        lastmod,
        changefreq: PROPERTY_CHANGEFREQ,
        priority: PROPERTY_PRIORITY,
      })
    );
  }

  lines.push('</urlset>', '');
  return lines.join('\n');
}

async function main() {
  const { fixtures, slugify } = await loadFixtureExports();
  const lastmod = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const xml = buildSitemapXml({ fixtures, slugify, siteUrl: SITE_URL, lastmod });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, xml, 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    `[sitemap] wrote ${OUTPUT_PATH} — ${fixtures.length} properties + ${ROUTES.length} static routes`
  );
}

// Only run main() when invoked as a CLI; importing for tests should not
// trigger a write.
const isMain =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[sitemap] generation failed:', err);
    process.exit(1);
  });
}
