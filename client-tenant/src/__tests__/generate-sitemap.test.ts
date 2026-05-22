// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs build script; no .d.ts shipped, imported by URL.
import { buildSitemapXml } from '../../scripts/generate-sitemap.mjs';
import { GPMG_FIXTURES, slugify } from '@/api/gpmg-fixtures';

const SITE_URL = 'https://frank-pilot.vercel.app';
const LASTMOD = '2026-05-22';

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

  it('includes every GPMG property slug at /discover/{slug}', () => {
    expect(GPMG_FIXTURES.length).toBe(17); // safety net for the fixture contract
    for (const p of GPMG_FIXTURES) {
      const slug = slugify(p.name);
      expect(xml).toContain(`<loc>${SITE_URL}/discover/${slug}</loc>`);
    }
  });

  it('marks property pages priority 0.8 daily', () => {
    const sampleSlug = slugify(GPMG_FIXTURES[0]!.name);
    const block = xml.match(
      new RegExp(
        `<url>\\s*<loc>https://[^/]+/discover/${sampleSlug}</loc>[\\s\\S]*?</url>`
      )
    )!;
    expect(block[0]).toContain('<priority>0.8</priority>');
    expect(block[0]).toContain('<changefreq>daily</changefreq>');
  });

  it('stamps every <url> with the provided lastmod (ISO YYYY-MM-DD)', () => {
    const lastmodMatches = xml.match(/<lastmod>[^<]+<\/lastmod>/g) ?? [];
    // 3 static routes + 17 properties = 20 url entries.
    expect(lastmodMatches.length).toBe(20);
    lastmodMatches.forEach((m) => {
      expect(m).toBe(`<lastmod>${LASTMOD}</lastmod>`);
    });
  });

  it('contains exactly 20 <url> entries (3 static + 17 properties)', () => {
    const urlOpenCount = (xml.match(/<url>/g) ?? []).length;
    const urlCloseCount = (xml.match(/<\/url>/g) ?? []).length;
    expect(urlOpenCount).toBe(20);
    expect(urlCloseCount).toBe(20);
  });
});
