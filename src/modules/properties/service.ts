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

  async getById(propertyId: string): Promise<PropertyRecord | null> {
    const result = await query(
      `SELECT ${ALL_COLUMNS} FROM properties WHERE id = $1`,
      [propertyId]
    );
    if (result.rows.length === 0) return null;
    return this.rowToRecord(result.rows[0]);
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
