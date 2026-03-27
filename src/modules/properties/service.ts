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
}

export interface UpdatePropertyInput {
  name?: string;
  addressLine2?: string;
  unitCount?: number;
  amiArea?: string;
  onesitePropertyId?: string;
  loftPropertyId?: string;
}

export class PropertyService {
  /**
   * List all properties, ordered by name.
   */
  async list(): Promise<PropertyRecord[]> {
    const result = await query(
      `SELECT id, name, address_line1, address_line2, city, state, zip,
              unit_count, ami_area, onesite_property_id, loft_property_id,
              created_at, updated_at
       FROM properties
       ORDER BY name`,
      []
    );

    return result.rows.map(this.rowToRecord);
  }

  /**
   * Get a single property by ID. Returns null if not found.
   */
  async getById(propertyId: string): Promise<PropertyRecord | null> {
    const result = await query(
      `SELECT id, name, address_line1, address_line2, city, state, zip,
              unit_count, ami_area, onesite_property_id, loft_property_id,
              created_at, updated_at
       FROM properties WHERE id = $1`,
      [propertyId]
    );

    if (result.rows.length === 0) return null;
    return this.rowToRecord(result.rows[0]);
  }

  /**
   * Create a new property.
   * Only asset_manager and system_admin can create properties (enforced at route layer).
   */
  async create(
    input: CreatePropertyInput,
    actorId: string,
    actorRole: string
  ): Promise<PropertyRecord> {
    const result = await query(
      `INSERT INTO properties
         (name, address_line1, address_line2, city, state, zip,
          unit_count, ami_area, onesite_property_id, loft_property_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, name, address_line1, address_line2, city, state, zip,
                 unit_count, ami_area, onesite_property_id, loft_property_id,
                 created_at, updated_at`,
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
      ]
    );

    const created = this.rowToRecord(result.rows[0]);

    await writeAuditLog({
      action: "property_created",
      actorId,
      actorRole,
      resourceType: "property",
      resourceId: created.id,
      details: {
        name: created.name,
        unitCount: created.unitCount,
        amiArea: created.amiArea,
      },
    });

    logger.info("Property created", { propertyId: created.id, name: created.name });

    return created;
  }

  /**
   * Update mutable fields on an existing property.
   * address_line1, city, state, zip are immutable after creation (coordinate with OneSite).
   * Returns the updated record, or throws if not found.
   */
  async update(
    propertyId: string,
    input: UpdatePropertyInput,
    actorId: string,
    actorRole: string
  ): Promise<PropertyRecord> {
    // Build SET clause dynamically from provided fields
    const sets: string[] = [];
    const params: unknown[] = [propertyId];

    if (input.name !== undefined) {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.addressLine2 !== undefined) {
      params.push(input.addressLine2);
      sets.push(`address_line2 = $${params.length}`);
    }
    if (input.unitCount !== undefined) {
      params.push(input.unitCount);
      sets.push(`unit_count = $${params.length}`);
    }
    if (input.amiArea !== undefined) {
      params.push(input.amiArea);
      sets.push(`ami_area = $${params.length}`);
    }
    if (input.onesitePropertyId !== undefined) {
      params.push(input.onesitePropertyId);
      sets.push(`onesite_property_id = $${params.length}`);
    }
    if (input.loftPropertyId !== undefined) {
      params.push(input.loftPropertyId);
      sets.push(`loft_property_id = $${params.length}`);
    }

    if (sets.length === 0) {
      throw new Error("No fields provided for update");
    }

    const result = await query(
      `UPDATE properties SET ${sets.join(", ")}
       WHERE id = $1
       RETURNING id, name, address_line1, address_line2, city, state, zip,
                 unit_count, ami_area, onesite_property_id, loft_property_id,
                 created_at, updated_at`,
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
      details: {
        changes: input,
      },
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
