/**
 * Minimal CSV ingestion for legacy wait-list files (Hawkins handoff).
 *
 * Deliberately NOT a general-purpose CSV library — it handles exactly what an
 * operator export throws at us (quoted fields, embedded commas, CRLF, BOM,
 * messy header names) and nothing more. No new dependency for one file format.
 *
 * Header mapping is fuzzy on purpose: One Site exports, hand-kept
 * spreadsheets, and re-saves through Excel all label columns differently.
 * Unknown columns are ignored; missing optional columns produce nulls.
 */

export interface WaitlistImportRow {
  position: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  bedrooms: number | null;
  listedAt: string | null;
  consent: boolean;
  consentSource: string | null;
}

/** RFC-4180-ish field splitter: quotes, escaped quotes, CR/LF tolerant. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

type CanonicalColumn =
  | "position"
  | "name"
  | "phone"
  | "email"
  | "bedrooms"
  | "listedAt"
  | "consent"
  | "consentSource";

function canonicalizeHeader(raw: string): CanonicalColumn | null {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["position", "pos", "rank", "number", "no", "order"].includes(key)) return "position";
  if (["name", "fullname", "applicant", "applicantname", "tenant", "tenantname"].includes(key)) return "name";
  if (["phone", "phonenumber", "cell", "mobile", "telephone", "tel"].includes(key)) return "phone";
  if (["email", "emailaddress", "mail"].includes(key)) return "email";
  if (["bedrooms", "bedroomcount", "br", "beds", "bed", "unitsize", "size"].includes(key)) return "bedrooms";
  if (["listed", "listedat", "dateadded", "added", "applied", "applieddate", "applicationdate", "date"].includes(key)) return "listedAt";
  if (["consent", "consentoutbound", "callconsent", "contactconsent", "okaytocall", "oktocall", "optin"].includes(key)) return "consent";
  if (["consentsource", "consentnote", "consentnotes"].includes(key)) return "consentSource";
  return null;
}

function parseTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  return /^(true|yes|y|1|x|si|sí|opt.?in|consented?)$/i.test(raw.trim());
}

function parseIntOrNull(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export interface CsvParseResult {
  rows: WaitlistImportRow[];
  errors: string[];
}

export function parseWaitlistCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const cleaned = text.replace(/^﻿/, "");
  const lines = cleaned.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["csv has no data rows (need a header line + at least one row)"] };
  }

  const headerCells = splitCsvLine(lines[0]);
  const columns = headerCells.map(canonicalizeHeader);
  if (!columns.includes("name")) {
    return { rows: [], errors: [`csv header has no recognizable name column (saw: ${headerCells.join(", ")})`] };
  }

  const rows: WaitlistImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (col: CanonicalColumn): string | undefined => {
      const idx = columns.indexOf(col);
      return idx === -1 ? undefined : cells[idx] || undefined;
    };

    const name = get("name") ?? null;
    if (!name) {
      errors.push(`row ${i + 1}: skipped — no name`);
      continue;
    }
    rows.push({
      position: parseIntOrNull(get("position")),
      name,
      phone: get("phone") ?? null,
      email: get("email") ?? null,
      bedrooms: parseIntOrNull(get("bedrooms")),
      listedAt: get("listedAt") ?? null,
      consent: parseTruthy(get("consent")),
      consentSource: get("consentSource") ?? null,
    });
  }
  return { rows, errors };
}
