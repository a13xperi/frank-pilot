#!/usr/bin/env node
/**
 * extract-gpmglv.mjs
 *
 * Reads the most recent docs/intel/raw/gpmglv/<date>/ snapshot produced by
 * scrape-gpmglv.mjs and emits structured JSON for downstream use:
 *
 *   docs/intel/gpmglv-properties-extracted.json
 *   docs/intel/gpmglv-site-extracted.json
 *
 * Zero external deps — uses regex + targeted DOM heuristics tuned to the
 * gpmglv.com Next.js template (uniform across 17 property pages).
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INTEL_DIR = path.join(ROOT, 'docs', 'intel');
const RAW_ROOT = path.join(INTEL_DIR, 'raw', 'gpmglv');

const extractionNotes = [];
function note(msg) {
  extractionNotes.push(msg);
}

// ---------- small HTML helpers ----------
function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function decode(s) {
  if (!s) return s;
  let out = s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  // Unescape backslash-escaped chars (from embedded JSON payloads)
  out = out
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\\/g, '\\');
  // Unicode escapes \uXXXX
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return out;
}

function stripTags(s) {
  return decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function metaContent(html, nameOrProperty) {
  const re = new RegExp(
    `<meta\\b[^>]*?(?:name|property)\\s*=\\s*["']${nameOrProperty}["'][^>]*?content\\s*=\\s*["']([^"']+)["']`,
    'i',
  );
  const m = html.match(re);
  if (m) return decode(m[1]);
  // also try content first
  const re2 = new RegExp(
    `<meta\\b[^>]*?content\\s*=\\s*["']([^"']+)["'][^>]*?(?:name|property)\\s*=\\s*["']${nameOrProperty}["']`,
    'i',
  );
  const m2 = html.match(re2);
  return m2 ? decode(m2[1]) : null;
}

function getTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? decode(m[1]).trim() : null;
}

function getH1(html) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : null;
}

function getAllByRegex(html, re) {
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m);
  return out;
}

function extractSpanList(html) {
  // Generic <span>text</span> capture (text-only)
  const re = /<span\b[^>]*>([^<]{2,160})<\/span>/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = decode(m[1]).trim();
    if (t) out.push(t);
  }
  return out;
}

function extractTelLinks(html) {
  const re = /tel:([+\d\-().\s]+)/gi;
  const set = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    set.add(m[1].replace(/[^\d]/g, ''));
  }
  return [...set];
}

function extractMailto(html) {
  const re = /mailto:([^"'>\s?]+)/gi;
  const set = new Set();
  let m;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return [...set];
}

function extractJSONLD(html) {
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      // ignore
    }
  }
  return out;
}

// ---------- per-property extraction ----------
function formatPhone(digits) {
  if (!digits) return null;
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return digits;
}

const CORPORATE_DIGITS = '7028738882'; // (702) 873-8882 — shared corporate number

// ---------- structured-data extraction ----------
// Each gpmglv property page embeds prev/current/next navigation data as
// escaped JSON inside the page payload. This is the cleanest source of
// per-property structured data (address/phone/fax/description/image/type)
// because gpmglv's leasing-block footer always shows the CORPORATE address.
//
// Pattern shape (after backslash-unescape):
//   "slug":"<slug>","address":"<line1>","city":"<city, ST ZIP>","phone":"<phone>"
//   ,"fax":"<fax?>","description":"<desc>","type":"senior|family"
//   ,"image":"/uploads/.../foo.jpg"
function buildStructuredIndex(homeFiles, rawDir) {
  const re = /\\"slug\\":\\"([^"]+)\\",\\"address\\":\\"([^"]+)\\",\\"city\\":\\"([^"]+)\\",\\"phone\\":\\"([^"]+)\\"(?:,\\"fax\\":\\"([^"]*)\\")?,\\"description\\":\\"([^"]+)\\",\\"type\\":\\"([^"]+)\\",\\"image\\":\\"([^"]+)\\"/g;
  const index = {};
  // Each property's data appears on its own page AND on its prev/next neighbors' pages,
  // so we just collect across all pages and dedupe by slug.
  return { re, index };
}

function parseCityField(cityRaw) {
  // Examples:
  //   "Las Vegas, NV 89106"
  //   "N. Las Vegas, NV 89030"
  //   "North Las Vegas, NV 89081"
  //   "Henderson, NV 89015"
  const m = cityRaw.match(/^(.+?)\s*,\s*([A-Z]{2})\s*(\d{5})$/);
  if (!m) return { city: cityRaw, state: 'NV', zip: null };
  let city = m[1].trim();
  // Normalize "N. Las Vegas" → "North Las Vegas"
  city = city.replace(/^N\.\s+Las Vegas$/i, 'North Las Vegas');
  return { city, state: m[2], zip: m[3] };
}

function extractAddress(html) {
  // Pattern: NUMBER + street tokens + street-type word, optionally followed by city, NV, ZIP
  // The gpmglv template puts addresses as plain text inside <span> or <p>. We find:
  //   "<digits> <words> (Street|Avenue|Boulevard|Blvd|Drive|Lane|Road|Way|Court|Ct|Place|Plaza|Circle|Pkwy|Parkway|Ave|St)\.?"
  const streetRe =
    /\b(\d{2,5}(?:\s*[NSEW]\.?)?\s+(?:[A-Z][A-Za-z0-9'.-]*\s+){1,5}(?:Street|St\.|Avenue|Ave\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Road|Rd\.?|Way|Court|Ct\.?|Place|Pl\.?|Plaza|Circle|Cir\.?|Parkway|Pkwy\.?))\b\.?/g;
  const streets = [];
  let m;
  while ((m = streetRe.exec(html)) !== null) {
    streets.push(m[1].trim());
  }
  // Dedup, keep first (typical pattern: street appears in hero, repeated in leasing block)
  const uniq = [...new Set(streets)];
  // Find city/zip pair near a street
  // We'll search a window after each street for "Las Vegas, NV ZIP" or "North Las Vegas, NV ZIP" or "Henderson, NV ZIP"
  const cityRe = /(Las Vegas|North Las Vegas|Henderson)\s*,?\s*NV\s*(\d{5})/g;
  const cityMatches = [];
  while ((m = cityRe.exec(html)) !== null) {
    cityMatches.push({ city: m[1], zip: m[2], idx: m.index });
  }
  if (!uniq.length) return null;
  // Pick the street that has a city match nearby (within 300 chars after)
  let bestStreet = uniq[0];
  let bestCity = cityMatches[0];
  for (const street of uniq) {
    const sIdx = html.indexOf(street);
    if (sIdx < 0) continue;
    const after = cityMatches.find((c) => c.idx > sIdx && c.idx - sIdx < 400);
    if (after) {
      bestStreet = street;
      bestCity = after;
      break;
    }
  }
  return {
    line1: bestStreet.replace(/\s+/g, ' ').trim(),
    city: bestCity?.city || null,
    state: 'NV',
    zip: bestCity?.zip || null,
  };
}

function extractDescription(html, h1) {
  // The hero subtitle: <p class="...max-w-2xl">... — usually under the H1 on a dark bg
  const heroMatches = getAllByRegex(
    html,
    /<p\b[^>]*class\s*=\s*"[^"]*max-w-2xl[^"]*"[^>]*>([^<]{30,600})<\/p>/g,
  );
  if (heroMatches.length) return decode(heroMatches[0][1]).trim();
  // Fallback: meta description
  const md = metaContent(html, 'description');
  return md || null;
}

function extractAmenities(html) {
  // Amenities are <span>{text}</span> bullets in the "What this community offers" section.
  // The next section is typically a "Why <name>?" or "Why Choose <name>?" heading.
  const start = html.indexOf('What this community offers');
  if (start < 0) return [];
  // Find next H2 after start
  const afterStart = html.slice(start + 30);
  const nextH2 = afterStart.search(/<h2\b/i);
  const end = nextH2 >= 0 ? start + 30 + nextH2 : html.length;
  const slice = html.slice(start, end);
  const spans = extractSpanList(slice);
  // Filter: amenity bullets are short (under 110 chars) and don't contain "Find" / "View"
  const exclude = /^(Find|View|See|Read|Explore|Apply|Call|Phone|Email|Address)\b/i;
  const out = [];
  for (const s of spans) {
    if (s.length > 130) continue;
    if (s.length < 6) continue;
    if (exclude.test(s)) continue;
    if (/\.\s*$/.test(s)) continue; // skip sentences ending in period
    if (out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

function extractAccessibility(html) {
  const out = [];
  if (/Reasonable accommodations available upon request/i.test(html)) {
    out.push('Reasonable accommodations available upon request');
  }
  if (/ADA accommodations/i.test(html)) {
    out.push('ADA accommodations available');
  }
  if (/Elevator access/i.test(html)) {
    out.push('Elevator access');
  }
  if (/Equal Housing Opportunity/i.test(html)) {
    out.push('Equal Housing Opportunity');
  }
  return [...new Set(out)];
}

function extractOfficeHours(html) {
  // Pattern observed: <span ...>Hours: </span>{text}</p>
  const m = html.match(/Hours:\s*<\/span>([^<]{4,200})/i);
  if (m) return decode(m[1]).trim();
  // Pattern observed on contact-us: <div ...>Office Hours</div>...<div ...>Mon – Fri</div><div ...>9:00 AM – 5:00 PM</div>
  const m2 = html.match(/Office Hours[\s\S]{0,200}?>([A-Z][a-z]{2,3}[\s\S]{1,40}?)<\/div>[\s\S]{0,80}?>([0-9:]+\s*[AP]M[\s\S]{1,40}?)<\/div>/);
  if (m2) return `${decode(m2[1]).trim()}, ${decode(m2[2]).trim()}`;
  return null;
}

function extractPetPolicy(html) {
  const m = html.match(/<span[^>]*>([^<]{3,200}?pet[^<]{0,200}?)<\/span>/i);
  if (m) return decode(m[1]).trim();
  return null;
}

function extractBedrooms(html) {
  const out = new Set();
  if (/Studio/i.test(html)) out.add('Studio');
  if (/\bone\b[\s-]*(?:&|and)\s*(?:two|2)\b[\s-]*bedroom/i.test(html)) {
    out.add('1BR');
    out.add('2BR');
  }
  if (/\b1[\s-]*(?:&|and|\/|to)?\s*2[\s-]*bedroom/i.test(html)) {
    out.add('1BR');
    out.add('2BR');
  }
  if (/\b3\s*[-]?\s*bedroom/i.test(html) || /three[\s-]*bedroom/i.test(html)) {
    out.add('3BR');
  }
  if (/1BR|one[\s-]?bedroom/i.test(html)) out.add('1BR');
  if (/2BR|two[\s-]?bedroom/i.test(html)) out.add('2BR');
  return [...out].sort();
}

function extractPropertyPhotos(html, baseUrl) {
  // <img src=... or preload as=image href=... or og:image
  const out = new Set();
  // <img src="...">
  const imgRe = /<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    let src = m[1];
    if (src.startsWith('data:')) continue;
    try {
      const u = new URL(src, baseUrl);
      if (u.hostname !== 'gpmglv.com' && u.hostname !== 'www.gpmglv.com') continue;
      // Skip logos / equal-housing icon / favicons
      if (/\/brand\//.test(u.pathname)) continue;
      if (/equal-housing-opportunity/.test(u.pathname)) continue;
      if (/(?:icon|favicon)/.test(u.pathname)) continue;
      // Skip Next image-optimization wrapper params; original is usually in /uploads/
      out.add(u.toString());
    } catch {
      // ignore
    }
  }
  // <link rel="preload" as="image" href="...">
  const preRe = /<link\b[^>]*\brel\s*=\s*"preload"[^>]*\bas\s*=\s*"image"[^>]*\bhref\s*=\s*"([^"]+)"/gi;
  while ((m = preRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], baseUrl);
      if (u.hostname !== 'gpmglv.com' && u.hostname !== 'www.gpmglv.com') continue;
      if (/\/brand\//.test(u.pathname)) continue;
      if (/equal-housing-opportunity/.test(u.pathname)) continue;
      out.add(u.toString());
    } catch {
      // ignore
    }
  }
  // og:image
  const og = metaContent(html, 'og:image');
  if (og) {
    try {
      const u = new URL(og, baseUrl);
      if (u.hostname === 'gpmglv.com' || u.hostname === 'www.gpmglv.com') {
        out.add(u.toString());
      }
    } catch {}
  }
  return [...out];
}

function extractPropertyType(html) {
  if (/Senior Living/i.test(html)) return 'senior';
  if (/Family Housing/i.test(html)) return 'family';
  if (/senior/i.test(html) && !/family/i.test(html)) return 'senior';
  if (/family/i.test(html) && !/senior/i.test(html)) return 'family';
  return null;
}

function extractTagline(html) {
  // The chip near the H1: <span class="...bg-sage|sand|...">Senior Living</span> isn't a tagline.
  // The hero subtitle (meta description) is the tagline candidate; we already capture as description.
  const m = html.match(/<h2\b[^>]*>Why Choose[^<]*<\/h2>/i);
  if (m) {
    const idx = html.indexOf(m[0]);
    // Next <p> after Why Choose
    const after = html.slice(idx, idx + 1200);
    const p = after.match(/<p[^>]*>([^<]{30,300})<\/p>/);
    if (p) return decode(p[1]).trim();
  }
  return null;
}

function extractManagerInfo(html) {
  // Look for "Leasing office" section then any name/email/phone
  const idx = html.indexOf('Leasing office');
  if (idx < 0) return { name: null, email: null };
  const section = html.slice(idx, idx + 1500);
  // Heuristic: a name is rarely disclosed — skip name detection unless explicit
  const email = section.match(/mailto:([^"'>\s]+)/);
  return {
    name: null,
    email: email ? email[1] : null,
  };
}

async function extractProperty(slug, rawDir, structured) {
  const filePath = path.join(rawDir, 'pages', 'homes', `${slug}.html`);
  if (!existsSync(filePath)) {
    return null;
  }
  const rawHtml = await readFile(filePath, 'utf8');
  const html = stripScripts(rawHtml);
  const url = `https://gpmglv.com/homes/${slug}`;

  const title = getTitle(rawHtml);
  const h1 = getH1(html);
  // Prefer the structured "name" field is not available, so derive from H1/title
  const name = h1 || (title ? title.replace(/\s*\|\s*GPMGLV\s*$/, '').trim() : slug);

  // Structured (high-confidence) fields first
  const struct = structured[slug];
  let address = null;
  let phone = null;
  let phone_alt = null;
  let fax = null;
  let property_type = null;
  let description = null;
  let primaryImageRel = null;

  if (struct) {
    const parsed = parseCityField(struct.city);
    address = {
      line1: struct.address,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
    };
    phone = struct.phone || null;
    fax = struct.fax || null;
    property_type = struct.type || null;
    description = struct.description || null;
    primaryImageRel = struct.image || null;
  }

  // Phone fallback / phone_alt from rendered tels
  const tels = extractTelLinks(html);
  if (!phone) {
    const leasingDigits = tels.find((t) => t !== CORPORATE_DIGITS);
    phone = formatPhone(leasingDigits || tels[0] || null);
  }
  if (tels.length > 1) {
    const corporate = tels.find((t) => t === CORPORATE_DIGITS);
    phone_alt = corporate ? formatPhone(corporate) : null;
  }

  const emails = extractMailto(html);
  const email = emails[0] || null;

  // If no structured data, fall back to heuristics
  if (!address) address = extractAddress(html);
  if (!description) description = extractDescription(html, h1);
  if (!property_type) property_type = extractPropertyType(html);

  const tagline = extractTagline(html);
  const amenities = extractAmenities(html);
  const accessibility = extractAccessibility(html);
  const office_hours = extractOfficeHours(html);
  const pet_policy = extractPetPolicy(html);
  const unit_types = extractBedrooms(html);
  let photo_urls = extractPropertyPhotos(html, url);
  if (primaryImageRel) {
    const abs = new URL(primaryImageRel, url).toString();
    // Promote primary image to front and dedupe
    photo_urls = [abs, ...photo_urls.filter((p) => p !== abs)];
  }
  const manager = extractManagerInfo(html);
  const json_ld = extractJSONLD(rawHtml);

  // Pricing / AMI disclosure check
  const rent_disclosed =
    /\$\d{2,4}(?:\s*[-–to]+\s*\$?\d{2,4})?\s*\/?(?:mo|month)/i.test(html);
  const ami_disclosed = /\b\d{2,3}\s*%\s*AMI\b/i.test(html);

  return {
    slug,
    name,
    url,
    address,
    phone,
    phone_alt,
    fax,
    email,
    property_type,
    description,
    tagline,
    amenities,
    accessibility,
    pet_policy,
    office_hours,
    manager_name: manager.name,
    manager_email: manager.email,
    unit_types,
    rent_disclosed,
    rent_text: null,
    ami_disclosed,
    ami_text: null,
    available_units_count: null,
    waitlist_url: `https://gpmglv.com/join-waitlist?property=${slug}`,
    application_url: null,
    photo_urls,
    primary_photo_url: photo_urls[0] || null,
    json_ld: json_ld.length ? json_ld : null,
    raw_html_path: path.relative(ROOT, filePath),
    extracted_at: new Date().toISOString(),
  };
}

// ---------- site-level extraction ----------
function extractFormFields(html) {
  const out = [];
  // inputs
  const inputRe = /<(input|select|textarea)\b([^>]*)>/gi;
  let m;
  let anonIdx = 0;
  while ((m = inputRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const name = attrs.match(/\b(?:name|id)\s*=\s*"([^"]+)"/);
    const type = attrs.match(/\btype\s*=\s*"([^"]+)"/);
    const placeholder = attrs.match(/\bplaceholder\s*=\s*"([^"]+)"/);
    const value = attrs.match(/\bvalue\s*=\s*"([^"]+)"/);
    const required = /\brequired\b/.test(attrs);
    out.push({
      tag,
      name: name ? name[1] : `__anon_${anonIdx++}`,
      type: type ? type[1] : tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text',
      placeholder: placeholder ? decode(placeholder[1]) : null,
      value: value ? decode(value[1]) : null,
      required,
      anonymous: !name,
    });
  }
  return out;
}

async function extractHomepage(rawDir) {
  const fp = path.join(rawDir, 'pages', 'index.html');
  if (!existsSync(fp)) return null;
  const raw = await readFile(fp, 'utf8');
  const html = stripScripts(raw);
  return {
    title: getTitle(raw),
    headline: getH1(html) || 'A Place to Call Home',
    subhead: metaContent(raw, 'description'),
    og_image: metaContent(raw, 'og:image'),
    cta_text: 'View Our Homes / Apply for Housing / Call us directly',
    featured_property_links: (() => {
      const set = new Set();
      const re = /href\s*=\s*"\/homes\/([a-z0-9-]+)"/gi;
      let m;
      while ((m = re.exec(html)) !== null) set.add(m[1]);
      return [...set];
    })(),
  };
}

async function extractAbout(rawDir) {
  const fp = path.join(rawDir, 'pages', 'about-us.html');
  if (!existsSync(fp)) return null;
  const raw = await readFile(fp, 'utf8');
  const html = stripScripts(raw);
  const paragraphs = [];
  const re = /<p\b[^>]*>([^<]{60,800})<\/p>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    paragraphs.push(decode(m[1]).trim());
  }
  const principles = [];
  const h3Re = /<h3\b[^>]*>([^<]+)<\/h3>/g;
  while ((m = h3Re.exec(html)) !== null) {
    principles.push(decode(m[1]).trim());
  }
  return {
    title: getTitle(raw),
    mission_text:
      paragraphs.find((p) => /manage properties for corporations/i.test(p)) || paragraphs[0] || null,
    description_paragraphs: paragraphs,
    six_principles: principles,
    founded: /\b2002\b/.test(html) ? 2002 : null,
    units_managed_claim: /1[,.]?000\+?\s*units/i.test(html) ? '1,000+' : null,
    leadership_named: null, // not disclosed in the public pages
  };
}

async function extractContact(rawDir) {
  const fp = path.join(rawDir, 'pages', 'contact-us.html');
  if (!existsSync(fp)) return null;
  const raw = await readFile(fp, 'utf8');
  const html = stripScripts(raw);
  return {
    title: getTitle(raw),
    form_fields: extractFormFields(html),
    office_address: extractAddress(html),
    office_phone: formatPhone(extractTelLinks(html)[0] || null),
    office_hours: extractOfficeHours(html),
    has_google_maps_embed: /maps\.google|google\.com\/maps/i.test(raw),
  };
}

async function extractWaitlist(rawDir) {
  const fp = path.join(rawDir, 'pages', 'join-waitlist.html');
  if (!existsSync(fp)) return null;
  const raw = await readFile(fp, 'utf8');
  const html = stripScripts(raw);
  const checkboxes = [];
  const re = /<input\b[^>]*type\s*=\s*"checkbox"[^>]*value\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    checkboxes.push(m[1]);
  }
  // Also catch property-selection checkboxes that lack `value=` — pull from
  // adjacent <label> text.
  const propertyChecks = [];
  // Find labels around checkboxes — gpmglv pattern: <label>...{property name}</label><input type=checkbox>
  // Heuristic: look for any property name from the structured index inside the page near a checkbox.
  // Simpler: collect <label>{text}</label> followed by checkbox input.
  const labelRe = /<label\b[^>]*>([^<]{3,80})<\/label>\s*<input\b[^>]*type\s*=\s*"checkbox"/gi;
  while ((m = labelRe.exec(html)) !== null) propertyChecks.push(decode(m[1]).trim());

  // Count anonymous checkboxes (those without name attribute) — likely the
  // 17-property selector list since each property checkbox is anonymous.
  const allCheckboxTags = html.match(/<input\b[^>]*type\s*=\s*"checkbox"[^>]*>/gi) || [];
  const namedCheckboxes = allCheckboxTags.filter((t) => /\bname\s*=/.test(t));
  const anonymousCheckboxCount = allCheckboxTags.length - namedCheckboxes.length;

  return {
    title: getTitle(raw),
    headline: getH1(html),
    form_fields: extractFormFields(html),
    property_checkboxes: checkboxes,
    property_checkbox_labels: propertyChecks,
    anonymous_checkbox_count: anonymousCheckboxCount,
    total_checkbox_count: allCheckboxTags.length,
    instructions_text:
      (html.match(/<p\b[^>]*>([^<]{60,400})<\/p>/) || [])[1]?.trim() || null,
    notes: [
      '"website" field is unlabeled — likely a honeypot for bot detection',
      'applicantName and phone ARE marked required (audit said "no required attributes" — partly inaccurate)',
      `${allCheckboxTags.length} checkboxes total: 4 named (aptTypes: studio/1br/2br/3br) + ${anonymousCheckboxCount} anonymous (presumed property-selection)`,
      'Multi-property submission supported via "Join selected waitlists" button',
    ],
  };
}

async function extractPortalMarketing(rawDir) {
  const out = {};
  for (const slug of ['portal', 'portal/lookup', 'portal/maintenance', 'portal/contact-management']) {
    const fp = path.join(rawDir, 'pages', `${slug}.html`);
    if (!existsSync(fp)) continue;
    const raw = await readFile(fp, 'utf8');
    const html = stripScripts(raw);
    out[slug] = {
      title: getTitle(raw),
      headline: getH1(html),
      form_fields: extractFormFields(html),
    };
  }
  return out;
}

async function extractFooter(rawDir) {
  const fp = path.join(rawDir, 'pages', 'index.html');
  if (!existsSync(fp)) return null;
  const raw = await readFile(fp, 'utf8');
  const html = stripScripts(raw);
  const footerMatch = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/);
  if (!footerMatch) {
    return { copyright: null, links: [], social: [] };
  }
  const footer = footerMatch[1];
  const links = [];
  // Capture any anchor including ones with nested <span>/<svg>
  const re = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(footer)) !== null) {
    const text = stripTags(m[2]);
    if (!text) continue;
    links.push({ href: m[1], text });
  }
  const copyright = (footer.match(/©[^<]{0,100}/) || [])[0] || null;
  return {
    copyright: copyright ? copyright.trim() : null,
    links,
    social: links.filter((l) => /facebook|twitter|instagram|linkedin|youtube/i.test(l.href)),
  };
}

async function extractNavigation(rawDir) {
  const fp = path.join(rawDir, 'pages', 'index.html');
  if (!existsSync(fp)) return null;
  const raw = await readFile(fp, 'utf8');
  const html = stripScripts(raw);
  const navMatch = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/);
  const main_links = [];
  if (navMatch) {
    const re = /<a\b[^>]*href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(navMatch[1])) !== null) {
      const text = stripTags(m[2]);
      if (!text) continue;
      main_links.push({ href: m[1], text });
    }
  }
  return { main_links };
}

// ---------- main ----------
async function main() {
  // Find most recent dated folder
  const dirs = (await readdir(RAW_ROOT, { withFileTypes: true })).filter((d) => d.isDirectory());
  if (!dirs.length) {
    console.error('No raw snapshots found in', RAW_ROOT);
    process.exit(2);
  }
  const latest = dirs.map((d) => d.name).sort().reverse()[0];
  const rawDir = path.join(RAW_ROOT, latest);
  console.log(`[extract-gpmglv] using snapshot: ${latest}`);

  // Discover all property slugs (from filesystem, not hardcoded list)
  const homesDir = path.join(rawDir, 'pages', 'homes');
  const homeFiles = existsSync(homesDir)
    ? (await readdir(homesDir)).filter((f) => f.endsWith('.html'))
    : [];
  const slugs = homeFiles.map((f) => f.replace(/\.html$/, '')).sort();
  console.log(`[extract-gpmglv] found ${slugs.length} property pages`);

  // First pass: build the structured-data index by scanning the embedded
  // prev/current/next payloads across all property pages (a property appears
  // on its own page AND on the pages of its two neighbors, giving us 3 chances
  // to capture each record).
  const structured = {};
  const structRe = /\\"slug\\":\\"([^"]+)\\",\\"address\\":\\"([^"]+)\\",\\"city\\":\\"([^"]+)\\",\\"phone\\":\\"([^"]+)\\"(?:,\\"fax\\":\\"([^"]*)\\")?,\\"description\\":\\"([^"]+)\\",\\"type\\":\\"([^"]+)\\",\\"image\\":\\"([^"]+)\\"/g;
  for (const slug of slugs) {
    const fp = path.join(homesDir, `${slug}.html`);
    const raw = await readFile(fp, 'utf8');
    let m;
    structRe.lastIndex = 0;
    while ((m = structRe.exec(raw)) !== null) {
      const [, s, addr, city, phone, fax, desc, type, image] = m;
      if (!structured[s]) {
        structured[s] = {
          slug: s,
          address: decode(addr),
          city: decode(city),
          phone: decode(phone),
          fax: fax ? decode(fax) : null,
          description: decode(desc),
          type: decode(type),
          image: decode(image),
        };
      }
    }
  }
  const missingStructured = slugs.filter((s) => !structured[s]);
  if (missingStructured.length) {
    note(`structured-data index missing ${missingStructured.length} slugs: ${missingStructured.join(',')}`);
  }
  console.log(`[extract-gpmglv] structured index covers ${Object.keys(structured).length}/${slugs.length} properties`);

  // Address-of-record overrides (slug -> corrected address fields). The GPMGLV
  // marketing site lists Donna Louise 2 at DL1's address (6225 Donna St) with a
  // coming-soon photo; the Clark County Assessor record (APN 124-26-103-002,
  // DONNA LOUISE 2 LLC, built 2025) is 6275 Donna St. Applied here so a re-scrape
  // never silently reverts the corrected address. Remove an entry once GPM fixes
  // their own listing. See battlestation docs/deals/DECISION-LOG.md D-2026-06-22-01.
  const ADDRESS_OVERRIDES = {
    'donna-louise-2-apartments': { line1: '6275 Donna St.' },
  };

  // Properties
  const properties = [];
  for (const slug of slugs) {
    const p = await extractProperty(slug, rawDir, structured);
    if (p) {
      const ov = ADDRESS_OVERRIDES[slug];
      if (ov && p.address) {
        for (const [k, v] of Object.entries(ov)) {
          if (p.address[k] !== v) {
            note(`property ${slug}: address.${k} overridden '${p.address[k]}' -> '${v}' (Assessor record)`);
            p.address[k] = v;
          }
        }
      }
      // Sanity log: count which fields are missing
      const missing = [];
      if (!p.description) missing.push('description');
      if (!p.address?.line1) missing.push('address.line1');
      if (!p.amenities?.length) missing.push('amenities');
      if (!p.photo_urls?.length) missing.push('photo_urls');
      if (missing.length) {
        note(`property ${slug}: missing ${missing.join(',')}`);
      }
      properties.push(p);
    }
  }

  // Site
  const homepage = await extractHomepage(rawDir);
  const about = await extractAbout(rawDir);
  const contact = await extractContact(rawDir);
  const waitlist = await extractWaitlist(rawDir);
  const portal = await extractPortalMarketing(rawDir);
  const footer = await extractFooter(rawDir);
  const navigation = await extractNavigation(rawDir);

  const site = {
    extracted_at: new Date().toISOString(),
    source_snapshot: latest,
    homepage,
    about,
    contact,
    waitlist,
    portal_marketing: portal,
    footer,
    navigation,
  };

  // Write outputs
  const propsPath = path.join(INTEL_DIR, 'gpmglv-properties-extracted.json');
  const sitePath = path.join(INTEL_DIR, 'gpmglv-site-extracted.json');

  await writeFile(
    propsPath,
    JSON.stringify(
      {
        extracted_at: new Date().toISOString(),
        source_snapshot: latest,
        property_count: properties.length,
        properties,
        extraction_notes: extractionNotes,
      },
      null,
      2,
    ),
  );
  await writeFile(sitePath, JSON.stringify(site, null, 2));

  console.log(`[extract-gpmglv] wrote ${path.relative(ROOT, propsPath)} (${properties.length} properties)`);
  console.log(`[extract-gpmglv] wrote ${path.relative(ROOT, sitePath)}`);
  if (extractionNotes.length) {
    console.log(`[extract-gpmglv] ${extractionNotes.length} extraction notes:`);
    extractionNotes.slice(0, 10).forEach((n) => console.log('  -', n));
    if (extractionNotes.length > 10) console.log(`  ... ${extractionNotes.length - 10} more`);
  }
}

main().catch((e) => {
  console.error('[extract-gpmglv] fatal:', e);
  process.exit(2);
});
