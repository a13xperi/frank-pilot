// Parse a OneSite (or generic) wait-list CSV export into normalized rows.
// Header matching is case/format-insensitive and alias-driven so a range of
// OneSite export shapes work without per-export configuration.

export interface RawWaitlistRow {
  sourceApplicantId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  bedroomCount?: number;
  sourcePosition?: number;
  sourceDateAdded?: string;
}

const ALIASES: Record<string, string[]> = {
  sourceApplicantId: ['applicantid', 'id', 'applicant', 'applicantnumber', 'tcode', 'prospectid'],
  firstName: ['firstname', 'first', 'fname', 'givenname'],
  lastName: ['lastname', 'last', 'lname', 'surname', 'familyname'],
  fullName: ['name', 'applicantname', 'fullname', 'prospectname'],
  phone: ['phone', 'phonenumber', 'mobile', 'cell', 'cellphone', 'primaryphone', 'contactphone'],
  email: ['email', 'emailaddress', 'e-mail'],
  bedroomCount: ['unitbedrooms', 'bedrooms', 'bedroomcount', 'br', 'beds', 'bedroom'],
  sourcePosition: ['position', 'rank', 'waitlistposition', 'order', 'seq', 'queueposition'],
  sourceDateAdded: ['dateadded', 'date', 'applieddate', 'appliedon', 'created', 'createddate', 'waitlistdate', 'datereceived'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (s: string) => s.replace(/[^0-9]/g, '');
const toInt = (s: string): number | undefined => {
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
};

// RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, commas, CRLF, BOM.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else { field += c; }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function parseOneSiteCsv(text: string): RawWaitlistRow[] {
  const grid = parseCsv(text);
  if (grid.length < 2) return [];
  const header = grid[0].map(norm);
  const colOf = (key: string): number => {
    const aliases = ALIASES[key] || [];
    for (let j = 0; j < header.length; j++) if (aliases.includes(header[j])) return j;
    return -1;
  };
  const idx = {
    sourceApplicantId: colOf('sourceApplicantId'),
    firstName: colOf('firstName'),
    lastName: colOf('lastName'),
    fullName: colOf('fullName'),
    phone: colOf('phone'),
    email: colOf('email'),
    bedroomCount: colOf('bedroomCount'),
    sourcePosition: colOf('sourcePosition'),
    sourceDateAdded: colOf('sourceDateAdded'),
  };
  const cell = (r: string[], j: number) => (j >= 0 && j < r.length ? r[j].trim() : '');

  const out: RawWaitlistRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    let first = cell(row, idx.firstName);
    let last = cell(row, idx.lastName);
    const full = cell(row, idx.fullName);
    if (!first && !last && full) {
      const parts = full.split(/\s+/);
      first = parts.shift() || '';
      last = parts.join(' ');
    }
    const phone = digits(cell(row, idx.phone));
    out.push({
      sourceApplicantId: cell(row, idx.sourceApplicantId) || undefined,
      firstName: first || undefined,
      lastName: last || undefined,
      phone: phone || undefined,
      email: cell(row, idx.email) || undefined,
      bedroomCount: toInt(cell(row, idx.bedroomCount)),
      sourcePosition: toInt(cell(row, idx.sourcePosition)),
      sourceDateAdded: cell(row, idx.sourceDateAdded) || undefined,
    });
  }
  return out;
}
