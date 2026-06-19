/**
 * Form 8823 export (B2).
 *
 * IRS Form 8823, "Low-Income Housing Credit Agencies Report of Noncompliance or
 * Building Disposition," is filed by the allocating state agency when a LIHTC
 * building falls out of §42 compliance. This module *assembles the data* an
 * 8823 needs from what the system already records — it does not file anything.
 *
 * The noncompliance signal here is the recertification income-ceiling layer
 * (QAP Phase 3.1/3.2): a recert whose income exceeds the unit's AMI ceiling
 * (`income_ceiling_verdict='over_income'`) opens a Next Available Unit
 * obligation; if that obligation is **lost** (or market rent gets applied) the
 * unit stops counting toward the set-aside — the classic 8823 "household income
 * above the income limit upon recertification" finding (Part II line 11c). Each
 * finding is tied to its building's BIN and carries the immutable compliance
 * tape entries as the evidence trail.
 *
 * Read-only: it queries recertifications + buildings + the compliance tape and
 * returns a typed report. Rendering to the actual government PDF is a separate
 * concern (the report shape is print-ready; see {@link summarizeForm8823}).
 */
import { query as dbQuery } from '../../config/database';
import { createTapeService } from '../tape/service';
import { PgTapeRepository } from '../tape/repository';
import type { TapeService } from '../tape/service';

/** The `query` function shape (config/database). Injectable for tests. */
export type QueryFn = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/**
 * Form 8823 noncompliance categories relevant to recert income enforcement.
 * (The form has ~17 line items; these are the ones this data layer can
 * substantiate. The code keeps the official line reference for the preparer.)
 */
export type NoncomplianceCategory =
  | 'over_income_recert'      // 11c: household income above limit at recertification
  | 'nau_lost'               // 11c + Available Unit Rule violation (set-aside lost)
  | 'market_rent_applied';   // unit converted to market rent (out of set-aside)

export const FORM_8823_LINE: Record<NoncomplianceCategory, string> = {
  over_income_recert: 'Part II, 11c — Household income above income limit upon recertification',
  nau_lost: 'Part II, 11c — Available Unit Rule violation (IRC §42(g)(2)(D)(ii))',
  market_rent_applied: 'Part II, 11c — Low-income unit converted to market-rate',
};

/** One out-of-compliance finding = one prospective Form 8823 record. */
export interface Form8823Record {
  recertId: string;
  /** Building Identification Number (Form 8609/8823 box). Null = not yet mapped. */
  bin: string | null;
  binConfidence: string | null;
  buildingCode: string | null;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  unitNumber: string | null;
  amiDesignation: string | null;
  tenantName: string;
  category: NoncomplianceCategory;
  /** Official 8823 line reference for {@link category}. */
  lineReference: string;
  /** Date the noncompliance was identified (income-ceiling check or NAU loss). */
  dateIdentified: string | null;
  /** Date corrected, if it has been (NAU satisfied). Null = still out of compliance. */
  dateCorrected: string | null;
  /** True once back in compliance (8823 "noncompliance corrected" box). */
  corrected: boolean;
  income: number | null;
  incomeLimit: number | null;
  /** Compliance-tape evidence entries backing this finding (hash-chained). */
  evidence: Form8823Evidence[];
}

export interface Form8823Evidence {
  kind: string;
  sequence: number;
  entryHash: string;
  createdAt: string;
  ruleCitation: string;
}

export interface Form8823Report {
  generatedAt: string;
  /** Filter scope echoed back. */
  propertyId: string | null;
  /** Whether already-corrected findings were included. */
  includeCorrected: boolean;
  records: Form8823Record[];
  summary: {
    total: number;
    open: number;
    corrected: number;
    byCategory: Record<NoncomplianceCategory, number>;
    /** Distinct BINs with at least one open finding. */
    binsAffected: number;
  };
}

interface RecertRow {
  id: string;
  tenant_name: string;
  income_ceiling_verdict: string | null;
  income_ceiling_income: string | null;
  income_ceiling_limit: string | null;
  income_ceiling_checked_at: Date | string | null;
  nau_status: string | null;
  nau_resolved_at: Date | string | null;
  market_rent_applied_at: Date | string | null;
  unit_number: string | null;
  ami_designation: string | null;
  property_id: string;
  property_name: string;
  address_line1: string;
  city: string | null;
  state: string | null;
  bin: string | null;
  bin_confidence: string | null;
  building_code: string | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Classify a recert row into its 8823 noncompliance category + corrected flag. */
function classify(row: RecertRow): { category: NoncomplianceCategory; corrected: boolean } | null {
  // NAU lost is the terminal set-aside loss — strongest finding.
  if (row.nau_status === 'lost') return { category: 'nau_lost', corrected: false };
  // Market rent applied without a lost-NAU still means the unit left the set-aside.
  if (row.market_rent_applied_at) return { category: 'market_rent_applied', corrected: false };
  // Over-income at recert. If the NAU obligation was satisfied, it's corrected.
  if (row.income_ceiling_verdict === 'over_income') {
    return { category: 'over_income_recert', corrected: row.nau_status === 'satisfied' };
  }
  return null;
}

export class Form8823Service {
  private query: QueryFn;
  private tape: TapeService;

  constructor(opts: { query?: QueryFn; tape?: TapeService } = {}) {
    this.query = opts.query ?? (dbQuery as unknown as QueryFn);
    this.tape = opts.tape ?? createTapeService(new PgTapeRepository());
  }

  /**
   * Assemble the Form 8823 data for noncompliant recertifications.
   *
   * @param opts.propertyId        restrict to one property (default: all).
   * @param opts.includeCorrected  include findings already brought back into
   *                               compliance (default false — 8823 typically
   *                               reports open noncompliance).
   * @param opts.withEvidence      attach compliance-tape evidence per record
   *                               (default true). Set false for a fast summary.
   */
  async assemble(opts: {
    propertyId?: string;
    includeCorrected?: boolean;
    withEvidence?: boolean;
  } = {}): Promise<Form8823Report> {
    const includeCorrected = opts.includeCorrected ?? false;
    const withEvidence = opts.withEvidence ?? true;

    const params: unknown[] = [];
    let propFilter = '';
    if (opts.propertyId) {
      params.push(opts.propertyId);
      propFilter = `AND r.property_id = $${params.length}`;
    }

    // Out-of-compliance recerts: over-income verdict, lost NAU, or market rent
    // applied. Join through application → claimed unit → building for the BIN.
    const res = await this.query(
      `SELECT r.id, r.tenant_name,
              r.income_ceiling_verdict, r.income_ceiling_income, r.income_ceiling_limit,
              r.income_ceiling_checked_at,
              r.nau_status, r.nau_resolved_at, r.market_rent_applied_at,
              u.unit_number, u.ami_designation,
              r.property_id, p.name AS property_name,
              p.address_line1, p.city, p.state,
              b.bin, b.bin_confidence, b.building_code
         FROM recertifications r
         JOIN properties p ON r.property_id = p.id
         JOIN applications a ON r.application_id = a.id
         LEFT JOIN units u ON a.claimed_unit_id = u.id
         LEFT JOIN buildings b ON u.building_id = b.id
        WHERE (r.income_ceiling_verdict = 'over_income'
               OR r.nau_status = 'lost'
               OR r.market_rent_applied_at IS NOT NULL)
          ${propFilter}
        ORDER BY r.income_ceiling_checked_at DESC NULLS LAST`,
      params,
    );

    const records: Form8823Record[] = [];
    for (const row of res.rows as RecertRow[]) {
      const cls = classify(row);
      if (!cls) continue;
      if (cls.corrected && !includeCorrected) continue;

      const evidence = withEvidence ? await this.evidenceFor(row.id) : [];
      const dateCorrected = cls.corrected ? iso(row.nau_resolved_at) : null;

      records.push({
        recertId: row.id,
        bin: row.bin ?? null,
        binConfidence: row.bin_confidence ?? null,
        buildingCode: row.building_code ?? null,
        propertyId: row.property_id,
        propertyName: row.property_name,
        propertyAddress: [row.address_line1, row.city, row.state].filter(Boolean).join(', '),
        unitNumber: row.unit_number ?? null,
        amiDesignation: row.ami_designation ?? null,
        tenantName: row.tenant_name,
        category: cls.category,
        lineReference: FORM_8823_LINE[cls.category],
        dateIdentified: iso(row.income_ceiling_checked_at) ?? iso(row.market_rent_applied_at),
        dateCorrected,
        corrected: cls.corrected,
        income: num(row.income_ceiling_income),
        incomeLimit: num(row.income_ceiling_limit),
        evidence,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      propertyId: opts.propertyId ?? null,
      includeCorrected,
      records,
      summary: summarize(records),
    };
  }

  /**
   * Pull the compliance-tape entries that substantiate a recert's finding.
   * The acq.* events are stamped at GLOBAL scope (applicant_id is null — they
   * are admin events), with the recert id inside `evidence.recertId`, so we read
   * the global chain and filter to this recert's acq events.
   */
  private async evidenceFor(recertId: string): Promise<Form8823Evidence[]> {
    const kinds = new Set([
      'acq.recert_income_checked',
      'acq.nau_triggered',
      'acq.nau_satisfied',
      'acq.nau_lost',
    ]);
    let entries;
    try {
      entries = await this.tape.list({ type: 'global' });
    } catch {
      return [];
    }
    const out: Form8823Evidence[] = [];
    for (const e of entries) {
      if (!kinds.has(e.kind)) continue;
      const ev = (e.payload?.evidence ?? {}) as Record<string, unknown>;
      if (ev.recertId !== recertId) continue;
      out.push({
        kind: e.kind,
        sequence: e.sequence,
        entryHash: e.entryHash,
        createdAt: e.createdAt,
        ruleCitation: e.payload?.ruleCitation ?? '',
      });
    }
    return out;
  }
}

function summarize(records: Form8823Record[]): Form8823Report['summary'] {
  const byCategory: Record<NoncomplianceCategory, number> = {
    over_income_recert: 0,
    nau_lost: 0,
    market_rent_applied: 0,
  };
  const openBins = new Set<string>();
  let corrected = 0;
  for (const r of records) {
    byCategory[r.category]++;
    if (r.corrected) corrected++;
    else if (r.bin) openBins.add(r.bin);
  }
  return {
    total: records.length,
    open: records.length - corrected,
    corrected,
    byCategory,
    binsAffected: openBins.size,
  };
}

/**
 * A compact, human-readable summary line per record — handy for a CSV row or a
 * preparer's worksheet header before the official PDF is produced.
 */
export function summarizeForm8823(report: Form8823Report): string[] {
  return report.records.map((r) =>
    [
      r.bin ?? 'BIN?',
      r.propertyName,
      r.unitNumber ?? '—',
      r.category,
      r.corrected ? 'CORRECTED' : 'OPEN',
      r.dateIdentified ?? '',
    ].join(' | '),
  );
}
