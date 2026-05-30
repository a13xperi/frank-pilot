import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

export interface PropertyRecord {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  unitCount: number;
  amiArea: string;
  onesitePropertyId: string | null;
  loftPropertyId: string | null;
  phone: string | null;
  email: string | null;
  propertyManager: string | null;
  propertyType: "senior" | "family" | "mixed_use";
  lihtcType: string | null;
  amiSetAside: string | null;
  compliancePeriodStart: string | null;
  compliancePeriodEnd: string | null;
  hasLura: boolean;
  hasMortgage: boolean;
  jurisdiction: string | null;
  unitMix: Record<string, number>;
  rentSchedule: Record<string, number>;
  totalVacancy: number;
  waitingListEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** LIHTC §42 Phase A: read-only building/BIN roster, populated only on the
   *  single-property detail (getById). Omitted on list/marker responses. */
  buildings?: BuildingSummary[];
}

/** Read-only building summary surfaced on the property detail response. */
export interface BuildingSummary {
  buildingCode: string;
  bin: string | null;
  binConfidence: "confirmed" | "provisional";
  unitCount: number;
}

// Wedge #8 — live unit availability rollup. Joined from the units table so the
// browse surface ("3 available", "Fully leased") doesn't have to ship a second
// request per tile.
export interface AvailabilityRollup {
  availableCount: number;
  leasedCount: number;
  totalUnits: number;
  bedroomBreakdown: {
    studio: number;
    br1: number;
    br2: number;
    br3: number;
  };
}

// Wedge #9 — honest-pricing rollup. Per-bedroom rent ranges + AMI tier
// disclosure so the public discover surface can show "Studio $850 · 1BR
// $975–1,100" without the applicant having to call a leasing agent first.
// Buckets with zero units in that bedroom are reported as null so callers
// can omit them cleanly.
export interface RentBucket {
  low: number;
  high: number;
}

export interface RentRange {
  studio: RentBucket | null;
  br1: RentBucket | null;
  br2: RentBucket | null;
  br3: RentBucket | null;
}

export type PropertyWithAvailability = PropertyRecord & {
  availability: AvailabilityRollup;
  // Wedge #9 — rent rollup + AMI tier on every listing tile.
  rentRange: RentRange;
  // Normalized AMI tier label (e.g. "60% AMI"). Falls back to the raw
  // `amiSetAside` column when it doesn't match the canonical tier set, and
  // to null for market-rate properties (NULL/empty `ami_set_aside`).
  amiTier: string | null;
};

// AMI tier order (lowest first). Mirrors `applicants/units?amiTier=` so the
// browse surface and the apply funnel use the same legal set.
export const AMI_TIER_ORDER = ["30", "50", "60", "80"] as const;
export type AmiTier = (typeof AMI_TIER_ORDER)[number];

// Bedroom filter values — kebab/lowercase to match URL chip semantics
// (?bedroom=studio|1|2|3). "3" is inclusive of 3BR+ on the rollup side so
// applicants browsing for a big home don't lose 4BR inventory.
export const BEDROOM_FILTERS = ["studio", "1", "2", "3"] as const;
export type BedroomFilter = (typeof BEDROOM_FILTERS)[number];

export const AVAILABILITY_FILTERS = ["available_now"] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];

export interface DiscoverFilters {
  amiTier?: AmiTier;
  bedroom?: BedroomFilter;
  availability?: AvailabilityFilter;
}

export interface CreatePropertyInput {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  unitCount: number;
  amiArea: string;
  onesitePropertyId?: string;
  loftPropertyId?: string;
  phone?: string;
  email?: string;
  propertyManager?: string;
  propertyType?: "senior" | "family" | "mixed_use";
  lihtcType?: string;
  amiSetAside?: string;
  compliancePeriodStart?: string;
  compliancePeriodEnd?: string;
  hasLura?: boolean;
  hasMortgage?: boolean;
  jurisdiction?: string;
  unitMix?: Record<string, number>;
  rentSchedule?: Record<string, number>;
  totalVacancy?: number;
  waitingListEnabled?: boolean;
}

export interface UpdatePropertyInput {
  name?: string;
  addressLine2?: string;
  unitCount?: number;
  amiArea?: string;
  onesitePropertyId?: string;
  loftPropertyId?: string;
  phone?: string;
  email?: string;
  propertyManager?: string;
  propertyType?: "senior" | "family" | "mixed_use";
  lihtcType?: string;
  amiSetAside?: string;
  compliancePeriodStart?: string;
  compliancePeriodEnd?: string;
  hasLura?: boolean;
  hasMortgage?: boolean;
  jurisdiction?: string;
  unitMix?: Record<string, number>;
  rentSchedule?: Record<string, number>;
  totalVacancy?: number;
  waitingListEnabled?: boolean;
}

const ALL_COLUMNS = `id, name, address_line1, address_line2, city, state, zip,
  unit_count, ami_area, onesite_property_id, loft_property_id,
  phone, email, property_manager, property_type, lihtc_type, ami_set_aside,
  compliance_period_start, compliance_period_end, has_lura, has_mortgage,
  jurisdiction, unit_mix, rent_schedule, total_vacancy, waiting_list_enabled,
  created_at, updated_at`;

export class PropertyService {
  async list(): Promise<PropertyRecord[]> {
    const result = await query(
      `SELECT ${ALL_COLUMNS} FROM properties ORDER BY name`,
      []
    );
    return result.rows.map(this.rowToRecord);
  }

  /**
   * Wedge #8 — list properties with a per-property availability rollup
   * (available/leased/total + Studio/1BR/2BR/3BR bedroom counts) and optional
   * filters that match `applicants/units?amiTier=` semantics so the browse
   * surface and the apply funnel agree.
   *
   *  - `amiTier` narrows to set-asides at or above the applicant's lowest
   *    qualifying tier (30 → all; 80 → 80% only). Market-rate properties
   *    (NULL/empty `ami_set_aside`) stay visible.
   *  - `bedroom` narrows by the rollup column (studio/1/2/3 — "3" is inclusive
   *    of 3BR+; a 3BR filter shows properties with at least one 3+ bedroom
   *    available unit).
   *  - `availability='available_now'` drops properties with zero currently
   *    available units (stale-held units treated as available, matching
   *    `applicants/units` behaviour).
   */
  async listWithAvailability(
    filters: DiscoverFilters = {}
  ): Promise<PropertyWithAvailability[]> {
    // Build the aggregate join — note: held units with a stale claim are
    // treated as available so the browse rollup matches the applicants/units
    // route's lazy-expire semantics (no cron required).
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.amiTier) {
      const idx = AMI_TIER_ORDER.indexOf(filters.amiTier);
      const allowedSetAsides = AMI_TIER_ORDER.slice(idx).map((t) => `${t}% AMI`);
      params.push(allowedSetAsides);
      conditions.push(
        `(p.ami_set_aside = ANY($${params.length}) OR p.ami_set_aside IS NULL OR p.ami_set_aside = '')`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // `is_available` mirrors applicants/units: status='available' OR a stale
    // hold. The bedroom buckets only count *available* units so the badge
    // "3 available · 2 BR" actually reflects what an applicant can claim.
    const propColumnsWithAlias = ALL_COLUMNS
      .split(",")
      .map((c) => c.trim())
      .map((c) => `p.${c}`)
      .join(", ");

    const sql = `
      SELECT
        ${propColumnsWithAlias},
        COALESCE(a.available_count, 0) AS available_count,
        COALESCE(a.leased_count, 0) AS leased_count,
        COALESCE(a.total_units, 0) AS total_units_actual,
        COALESCE(a.studio_count, 0) AS studio_count,
        COALESCE(a.br1_count, 0) AS br1_count,
        COALESCE(a.br2_count, 0) AS br2_count,
        COALESCE(a.br3_count, 0) AS br3_count,
        a.studio_rent_min, a.studio_rent_max,
        a.br1_rent_min, a.br1_rent_max,
        a.br2_rent_min, a.br2_rent_max,
        a.br3_rent_min, a.br3_rent_max
      FROM properties p
      LEFT JOIN (
        SELECT
          u.property_id,
          COUNT(*) FILTER (
            WHERE u.status = 'available'
               OR (u.status = 'held' AND u.claim_expires_at < NOW())
          ) AS available_count,
          COUNT(*) FILTER (WHERE u.status = 'leased') AS leased_count,
          COUNT(*) AS total_units,
          COUNT(*) FILTER (
            WHERE u.bedrooms = 0
              AND (u.status = 'available'
                   OR (u.status = 'held' AND u.claim_expires_at < NOW()))
          ) AS studio_count,
          COUNT(*) FILTER (
            WHERE u.bedrooms = 1
              AND (u.status = 'available'
                   OR (u.status = 'held' AND u.claim_expires_at < NOW()))
          ) AS br1_count,
          COUNT(*) FILTER (
            WHERE u.bedrooms = 2
              AND (u.status = 'available'
                   OR (u.status = 'held' AND u.claim_expires_at < NOW()))
          ) AS br2_count,
          COUNT(*) FILTER (
            WHERE u.bedrooms >= 3
              AND (u.status = 'available'
                   OR (u.status = 'held' AND u.claim_expires_at < NOW()))
          ) AS br3_count,
          -- Wedge #9 — per-bedroom rent ranges. Min/max over every unit
          -- regardless of status, so the public range reflects the whole
          -- community's rent schedule, not just what's available today.
          MIN(u.monthly_rent) FILTER (WHERE u.bedrooms = 0) AS studio_rent_min,
          MAX(u.monthly_rent) FILTER (WHERE u.bedrooms = 0) AS studio_rent_max,
          MIN(u.monthly_rent) FILTER (WHERE u.bedrooms = 1) AS br1_rent_min,
          MAX(u.monthly_rent) FILTER (WHERE u.bedrooms = 1) AS br1_rent_max,
          MIN(u.monthly_rent) FILTER (WHERE u.bedrooms = 2) AS br2_rent_min,
          MAX(u.monthly_rent) FILTER (WHERE u.bedrooms = 2) AS br2_rent_max,
          MIN(u.monthly_rent) FILTER (WHERE u.bedrooms >= 3) AS br3_rent_min,
          MAX(u.monthly_rent) FILTER (WHERE u.bedrooms >= 3) AS br3_rent_max
        FROM units u
        GROUP BY u.property_id
      ) a ON a.property_id = p.id
      ${whereClause}
      ORDER BY p.name
    `;

    const result = await query(sql, params);

    let rows = result.rows.map((row) => {
      const record = this.rowToRecord(row);
      const availability: AvailabilityRollup = {
        availableCount: Number(row.available_count) || 0,
        leasedCount: Number(row.leased_count) || 0,
        totalUnits: Number(row.total_units_actual) || 0,
        bedroomBreakdown: {
          studio: Number(row.studio_count) || 0,
          br1: Number(row.br1_count) || 0,
          br2: Number(row.br2_count) || 0,
          br3: Number(row.br3_count) || 0,
        },
      };
      const rentRange: RentRange = {
        studio: rentBucket(row.studio_rent_min, row.studio_rent_max),
        br1: rentBucket(row.br1_rent_min, row.br1_rent_max),
        br2: rentBucket(row.br2_rent_min, row.br2_rent_max),
        br3: rentBucket(row.br3_rent_min, row.br3_rent_max),
      };
      return {
        ...record,
        availability,
        rentRange,
        amiTier: normalizeAmiTier(record.amiSetAside),
      } as PropertyWithAvailability;
    });

    // Bedroom filter is applied post-aggregate so a single SQL covers all
    // bedroom columns and amiTier; the alternative (predicate per chip) would
    // duplicate the WHERE-clause logic into the FILTER expressions.
    if (filters.bedroom) {
      rows = rows.filter((r) => {
        switch (filters.bedroom) {
          case "studio":
            return r.availability.bedroomBreakdown.studio > 0;
          case "1":
            return r.availability.bedroomBreakdown.br1 > 0;
          case "2":
            return r.availability.bedroomBreakdown.br2 > 0;
          case "3":
            return r.availability.bedroomBreakdown.br3 > 0;
          default:
            return true;
        }
      });
    }

    if (filters.availability === "available_now") {
      rows = rows.filter((r) => r.availability.availableCount > 0);
    }

    return rows;
  }

  /**
   * Wedge #8 — bedroom-grouped available units for a single property.
   * Drives the "Live availability" section on /property/:slug. Stale-held
   * units are treated as available (matching applicants/units behaviour).
   */
  async getAvailability(
    propertyId: string
  ): Promise<{
    propertyId: string;
    availableCount: number;
    bedroomBreakdown: AvailabilityRollup["bedroomBreakdown"];
    units: Array<{
      id: string;
      unitNumber: string;
      bedrooms: number;
      bathrooms: number;
      sqft: number | null;
      monthlyRent: number;
      availableFrom: string | null;
    }>;
  } | null> {
    const propertyExists = await query(
      `SELECT id FROM properties WHERE id = $1`,
      [propertyId]
    );
    if (propertyExists.rows.length === 0) return null;

    const unitsResult = await query(
      `SELECT id, unit_number, bedrooms, bathrooms, sqft, monthly_rent, available_from
         FROM units
        WHERE property_id = $1
          AND (status = 'available'
               OR (status = 'held' AND claim_expires_at < NOW()))
        ORDER BY bedrooms ASC, monthly_rent ASC, unit_number ASC`,
      [propertyId]
    );

    const units = unitsResult.rows.map((row) => ({
      id: row.id,
      unitNumber: row.unit_number,
      bedrooms: Number(row.bedrooms),
      bathrooms: Number(row.bathrooms),
      sqft: row.sqft === null ? null : Number(row.sqft),
      monthlyRent: Number(row.monthly_rent),
      availableFrom: row.available_from
        ? new Date(row.available_from).toISOString().split("T")[0] ?? null
        : null,
    }));

    const bedroomBreakdown = {
      studio: units.filter((u) => u.bedrooms === 0).length,
      br1: units.filter((u) => u.bedrooms === 1).length,
      br2: units.filter((u) => u.bedrooms === 2).length,
      br3: units.filter((u) => u.bedrooms >= 3).length,
    };

    return {
      propertyId,
      availableCount: units.length,
      bedroomBreakdown,
      units,
    };
  }

  /**
   * Full-unify — map markers. Returns every property that has geocoordinates,
   * in the shape the statewide Nevada housing map consumes
   * (`{slug, name, city, type, totalUnits, restrictedUnits, lat, lng}`).
   *
   * `slug` is derived in SQL with the SAME normalization the rest of the app
   * uses (LOWER → non-alnum→'-' → trim '-') so a marker popup's
   * `/property/<slug>` link resolves against `resolvePropertyIdBySlug`.
   *
   * `type` is mapped back to the map's capitalized vocabulary
   * (senior→Senior, family→Family, mixed_use→Mixed) so the marker icon/filter
   * code reads it unchanged. `restrictedUnits` isn't tracked on `properties`,
   * so we surface `unit_count` (every unit in this LIHTC catalog is
   * income-restricted) — callers can treat total≈restricted.
   *
   * Anonymous / read-only: no PII, no compliance metadata, no internal IDs.
   */
  async listMapMarkers(): Promise<
    Array<{
      slug: string;
      name: string;
      city: string;
      type: "Family" | "Senior" | "Mixed";
      totalUnits: number;
      restrictedUnits: number;
      lat: number;
      lng: number;
    }>
  > {
    const result = await query(
      `SELECT
         trim(BOTH '-' FROM regexp_replace(LOWER(name), '[^a-z0-9]+', '-', 'g')) AS slug,
         name,
         city,
         property_type,
         unit_count,
         latitude,
         longitude
       FROM properties
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY name ASC`,
      []
    );

    const typeLabel: Record<string, "Family" | "Senior" | "Mixed"> = {
      senior: "Senior",
      family: "Family",
      mixed_use: "Mixed",
    };

    return result.rows.map((row) => {
      const total = Number(row.unit_count) || 0;
      return {
        slug: row.slug,
        name: row.name,
        city: row.city,
        type: typeLabel[row.property_type] ?? "Family",
        totalUnits: total,
        restrictedUnits: total,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
      };
    });
  }

  async getById(propertyId: string): Promise<PropertyRecord | null> {
    const result = await query(
      `SELECT ${ALL_COLUMNS} FROM properties WHERE id = $1`,
      [propertyId]
    );
    if (result.rows.length === 0) return null;
    const record = this.rowToRecord(result.rows[0]);

    // LIHTC §42 Phase A: attach the read-only building/BIN roster. Read-only —
    // no behavior change. Tolerant of a DB that predates the buildings table.
    try {
      const buildingsRes = await query(
        `SELECT building_code, bin, bin_confidence, unit_count
           FROM buildings
          WHERE property_id = $1
          ORDER BY building_code`,
        [propertyId]
      );
      record.buildings = buildingsRes.rows.map((row: any) => ({
        buildingCode: row.building_code,
        bin: row.bin ?? null,
        binConfidence: row.bin_confidence,
        unitCount: row.unit_count,
      }));
    } catch (err) {
      // Buildings table may not exist yet (pre-migration DB) — surface nothing.
      logger.warn("getById: buildings roster unavailable", {
        propertyId,
        error: (err as Error).message,
      });
    }

    return record;
  }

  async create(
    input: CreatePropertyInput,
    actorId: string,
    actorRole: string
  ): Promise<PropertyRecord> {
    const result = await query(
      `INSERT INTO properties
         (name, address_line1, address_line2, city, state, zip,
          unit_count, ami_area, onesite_property_id, loft_property_id,
          phone, email, property_manager, property_type, lihtc_type, ami_set_aside,
          compliance_period_start, compliance_period_end, has_lura, has_mortgage,
          jurisdiction, unit_mix, rent_schedule, total_vacancy, waiting_list_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING ${ALL_COLUMNS}`,
      [
        input.name,
        input.addressLine1,
        input.addressLine2 || null,
        input.city,
        input.state,
        input.zip,
        input.unitCount,
        input.amiArea,
        input.onesitePropertyId || null,
        input.loftPropertyId || null,
        input.phone || null,
        input.email || null,
        input.propertyManager || null,
        input.propertyType || "family",
        input.lihtcType || null,
        input.amiSetAside || null,
        input.compliancePeriodStart || null,
        input.compliancePeriodEnd || null,
        input.hasLura ?? false,
        input.hasMortgage ?? false,
        input.jurisdiction || null,
        JSON.stringify(input.unitMix || {}),
        JSON.stringify(input.rentSchedule || {}),
        input.totalVacancy ?? 0,
        input.waitingListEnabled ?? false,
      ]
    );

    const created = this.rowToRecord(result.rows[0]);

    await writeAuditLog({
      action: "property_created",
      actorId,
      actorRole,
      resourceType: "property",
      resourceId: created.id,
      details: { name: created.name, unitCount: created.unitCount, amiArea: created.amiArea },
    });

    logger.info("Property created", { propertyId: created.id, name: created.name });
    return created;
  }

  async update(
    propertyId: string,
    input: UpdatePropertyInput,
    actorId: string,
    actorRole: string
  ): Promise<PropertyRecord> {
    const sets: string[] = [];
    const params: unknown[] = [propertyId];

    const addField = (key: string, col: string, val: unknown, isJson = false) => {
      if (val !== undefined) {
        params.push(isJson ? JSON.stringify(val) : val);
        sets.push(`${col} = $${params.length}`);
      }
    };

    addField("name", "name", input.name);
    addField("addressLine2", "address_line2", input.addressLine2);
    addField("unitCount", "unit_count", input.unitCount);
    addField("amiArea", "ami_area", input.amiArea);
    addField("onesitePropertyId", "onesite_property_id", input.onesitePropertyId);
    addField("loftPropertyId", "loft_property_id", input.loftPropertyId);
    addField("phone", "phone", input.phone);
    addField("email", "email", input.email);
    addField("propertyManager", "property_manager", input.propertyManager);
    addField("propertyType", "property_type", input.propertyType);
    addField("lihtcType", "lihtc_type", input.lihtcType);
    addField("amiSetAside", "ami_set_aside", input.amiSetAside);
    addField("compliancePeriodStart", "compliance_period_start", input.compliancePeriodStart);
    addField("compliancePeriodEnd", "compliance_period_end", input.compliancePeriodEnd);
    addField("hasLura", "has_lura", input.hasLura);
    addField("hasMortgage", "has_mortgage", input.hasMortgage);
    addField("jurisdiction", "jurisdiction", input.jurisdiction);
    addField("unitMix", "unit_mix", input.unitMix, true);
    addField("rentSchedule", "rent_schedule", input.rentSchedule, true);
    addField("totalVacancy", "total_vacancy", input.totalVacancy);
    addField("waitingListEnabled", "waiting_list_enabled", input.waitingListEnabled);

    if (sets.length === 0) {
      throw new Error("No fields provided for update");
    }

    const result = await query(
      `UPDATE properties SET ${sets.join(", ")} WHERE id = $1 RETURNING ${ALL_COLUMNS}`,
      params
    );

    if (result.rows.length === 0) {
      throw new Error(`Property not found: ${propertyId}`);
    }

    const updated = this.rowToRecord(result.rows[0]);

    await writeAuditLog({
      action: "property_updated",
      actorId,
      actorRole,
      resourceType: "property",
      resourceId: propertyId,
      details: { changes: input },
    });

    logger.info("Property updated", { propertyId, changes: Object.keys(input) });
    return updated;
  }

  /**
   * Wedge #9 — per-bedroom rent range + AMI tier for a single property.
   * Drives the "Rent & AMI disclosure" section on /property/:slug. Buckets
   * with zero units in that bedroom return null so callers can omit them.
   */
  async getRentRange(
    propertyId: string
  ): Promise<{
    propertyId: string;
    rentRange: RentRange;
    amiTier: string | null;
  } | null> {
    const propResult = await query(
      `SELECT ami_set_aside FROM properties WHERE id = $1`,
      [propertyId]
    );
    if (propResult.rows.length === 0) return null;

    const rentResult = await query(
      `SELECT
         MIN(monthly_rent) FILTER (WHERE bedrooms = 0) AS studio_min,
         MAX(monthly_rent) FILTER (WHERE bedrooms = 0) AS studio_max,
         MIN(monthly_rent) FILTER (WHERE bedrooms = 1) AS br1_min,
         MAX(monthly_rent) FILTER (WHERE bedrooms = 1) AS br1_max,
         MIN(monthly_rent) FILTER (WHERE bedrooms = 2) AS br2_min,
         MAX(monthly_rent) FILTER (WHERE bedrooms = 2) AS br2_max,
         MIN(monthly_rent) FILTER (WHERE bedrooms >= 3) AS br3_min,
         MAX(monthly_rent) FILTER (WHERE bedrooms >= 3) AS br3_max
       FROM units
       WHERE property_id = $1`,
      [propertyId]
    );

    const r = rentResult.rows[0] || {};
    const rentRange: RentRange = {
      studio: rentBucket(r.studio_min, r.studio_max),
      br1: rentBucket(r.br1_min, r.br1_max),
      br2: rentBucket(r.br2_min, r.br2_max),
      br3: rentBucket(r.br3_min, r.br3_max),
    };

    return {
      propertyId,
      rentRange,
      amiTier: normalizeAmiTier(propResult.rows[0].ami_set_aside),
    };
  }

  private rowToRecord(row: any): PropertyRecord {
    return {
      id: row.id,
      name: row.name,
      addressLine1: row.address_line1,
      addressLine2: row.address_line2 || null,
      city: row.city,
      state: row.state,
      zip: row.zip,
      unitCount: row.unit_count,
      amiArea: row.ami_area,
      onesitePropertyId: row.onesite_property_id || null,
      loftPropertyId: row.loft_property_id || null,
      phone: row.phone || null,
      email: row.email || null,
      propertyManager: row.property_manager || null,
      propertyType: row.property_type || "family",
      lihtcType: row.lihtc_type || null,
      amiSetAside: row.ami_set_aside || null,
      compliancePeriodStart: row.compliance_period_start
        ? row.compliance_period_start.toISOString().split("T")[0]
        : null,
      compliancePeriodEnd: row.compliance_period_end
        ? row.compliance_period_end.toISOString().split("T")[0]
        : null,
      hasLura: row.has_lura || false,
      hasMortgage: row.has_mortgage || false,
      jurisdiction: row.jurisdiction || null,
      unitMix: row.unit_mix || {},
      rentSchedule: row.rent_schedule || {},
      totalVacancy: row.total_vacancy || 0,
      waitingListEnabled: row.waiting_list_enabled || false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ── Wedge #9 helpers ────────────────────────────────────────────────────────

/**
 * Build a `{low, high}` rent bucket from raw SQL min/max aggregates. Returns
 * null when either side is missing (no units in that bedroom for the
 * property). Coerces NUMERIC strings out of pg into integers — monthly_rent
 * is stored whole-dollar.
 */
function rentBucket(min: unknown, max: unknown): RentBucket | null {
  if (min === null || min === undefined || max === null || max === undefined) {
    return null;
  }
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low: Math.round(low), high: Math.round(high) };
}

/**
 * Canonicalize the `ami_set_aside` column for the discover disclosure. The
 * column stores values like "60% AMI" verbatim (see seed.ts:189) — pass
 * those through. Empty/NULL → null (market-rate). Anything else → return
 * the raw value so we don't silently drop unfamiliar tiers.
 */
function normalizeAmiTier(amiSetAside: string | null): string | null {
  if (!amiSetAside || amiSetAside.trim() === "") return null;
  return amiSetAside;
}
