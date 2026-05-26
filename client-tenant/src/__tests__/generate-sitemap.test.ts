// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs build script; no .d.ts shipped, imported by URL.
import { buildSitemapXml } from '../../scripts/generate-sitemap.mjs';
import { GPMG_FIXTURES, GPMG_CITIES, slugify } from '@/api/gpmg-fixtures';

const SITE_URL = 'https://frank-pilot.vercel.app';
const LASTMOD = '2026-05-22';

// 3 static routes + one /property/{slug} per fixture + one /discover/city/{slug}
// per city with ≥1 property.
const STATIC_ROUTES = 3;
const EXPECTED_URLS = STATIC_ROUTES + GPMG_FIXTURES.length + GPMG_CITIES.length;

describe('generate-sitemap', () => {
  const xml = buildSitemapXml({
    fixtures: GPMG_FIXTURES,
    slugify,
    siteUrl: SITE_URL,
    lastmod: LASTMOD,
  });

  it('starts with the XML prolog and urlset element', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml).toContain('</urlset>');
  });

  it('emits the three static routes with the spec priorities', () => {
    expect(xml).toContain(`<loc>${SITE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/discover</loc>`);
    expect(xml).toContain(`<loc>${SITE_URL}/apply</loc>`);

    // Welcome (/) — priority 1.0, monthly.
    const welcomeBlock = xml.match(/<url>\s*<loc>https:\/\/[^/]+\/<\/loc>[\s\S]*?<\/url>/)!;
    expect(welcomeBlock[0]).toContain('<priority>1.0</priority>');
    expect(welcomeBlock[0]).toContain('<changefreq>monthly</changefreq>');

    // /discover — priority 0.9, daily.
    const discoverBlock = xml.match(
      /<url>\s*<loc>https:\/\/[^/]+\/discover<\/loc>[\s\S]*?<\/url>/
    )!;
    expect(discoverBlock[0]).toContain('<priority>0.9</priority>');
    expect(discoverBlock[0]).toContain('<changefreq>daily</changefreq>');

    // /apply — priority 0.5, monthly.
    const applyBlock = xml.match(
      /<url>\s*<loc>https:\/\/[^/]+\/apply<\/loc>[\s\S]*?<\/url>/
    )!;
    expect(applyBlock[0]).toContain('<priority>0.5</priority>');
    expect(applyBlock[0]).toContain('<changefreq>monthly</changefreq>');
  });

  it('includes every GPMG property slug at /property/{slug}', () => {
    // Must match the React route (App.tsx `/property/:slug`) and the in-app
    // PropertyList card link — `/discover/{slug}` has no route and redirects
    // logged-out crawlers to /login, dropping the listing JSON-LD from the index.
    expect(GPMG_FIXTURES.length).toBe(17); // safety net for the fixture contract
    for (const p of GPMG_FIXTURES) {
      const slug = slugify(p.name);
      expect(xml).toContain(`<loc>${SITE_URL}/property/${slug}</loc>`);
    }
  });

  it('marks property pages priority 0.8 daily', () => {
    const sampleSlug = slugify(GPMG_FIXTURES[0]!.name);
    const block = xml.match(
      new RegExp(
        `<url>\\s*<loc>https://[^/]+/property/${sampleSlug}</loc>[\\s\\S]*?</url>`
      )
    )!;
    expect(block[0]).toContain('<priority>0.8</priority>');
    expect(block[0]).toContain('<changefreq>daily</changefreq>');
  });

  it('includes every GPMG city at /discover/city/{slug}', () => {
    // City landing pages are the SEO wedge — one crawlable page per city with
    // inventory, keyed off GPMG_CITIES (derived from the fixtures).
    expect(GPMG_CITIES.length).toBeGreaterThan(0);
    for (const c of GPMG_CITIES) {
      expect(xml).toContain(`<loc>${SITE_URL}/discover/city/${c.slug}</loc>`);
    }
  });

  it('marks city pages priority 0.7 weekly', () => {
    const sampleCity = GPMG_CITIES[0]!.slug;
    const block = xml.match(
      new RegExp(
        `<url>\\s*<loc>https://[^/]+/discover/city/${sampleCity}</loc>[\\s\\S]*?</url>`
      )
    )!;
    expect(block[0]).toContain('<priority>0.7</priority>');
    expect(block[0]).toContain('<changefreq>weekly</changefreq>');
  });

  it('stamps every <url> with the provided lastmod (ISO YYYY-MM-DD)', () => {
    const lastmodMatches = xml.match(/<lastmod>[^<]+<\/lastmod>/g) ?? [];
    expect(lastmodMatches.length).toBe(EXPECTED_URLS);
    lastmodMatches.forEach((m) => {
      expect(m).toBe(`<lastmod>${LASTMOD}</lastmod>`);
    });
  });

  it('contains the expected <url> count (static + properties + cities)', () => {
    const urlOpenCount = (xml.match(/<url>/g) ?? []).length;
    const urlCloseCount = (xml.match(/<\/url>/g) ?? []).length;
    expect(urlOpenCount).toBe(EXPECTED_URLS);
    expect(urlCloseCount).toBe(EXPECTED_URLS);
  });
});
