import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope } from "../../middleware/scope";

export class InspectionService {
  async schedule(
    propertyId: string,
    inspectionType: string,
    scheduledDate: string,
    actorId: string,
    actorRole: string,
    unitNumber?: string,
    applicationId?: string
  ): Promise<{ id: string }> {
    const result = await query(
      `INSERT INTO inspections
         (property_id, application_id, unit_number, inspection_type, scheduled_date, inspector_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [propertyId, applicationId || null, unitNumber || null, inspectionType, scheduledDate, actorId]
    );

    await writeAuditLog({
      action: "inspection_scheduled",
      actorId, actorRole,
      applicationId: applicationId || undefined,
      resourceType: "inspection",
      resourceId: result.rows[0].id,
      details: { propertyId, inspectionType, scheduledDate, unitNumber },
    });

    return { id: result.rows[0].id };
  }

  async complete(
    inspectionId: string,
    actorId: string,
    actorRole: string,
    data: {
      notes?: string;
      roomDetails?: Record<string, unknown>;
      smokeDetectorOk?: boolean;
      hqsCompliant?: boolean;
      followUpRequired?: boolean;
      followUpNotes?: string;
    }
  ): Promise<void> {
    const result = await query(
      `UPDATE inspections
       SET status = 'completed', completed_date = CURRENT_DATE,
           notes = $2, room_details = $3, smoke_detector_ok = $4, hqs_compliant = $5,
           follow_up_required = $6, follow_up_notes = $7
       WHERE id = $1
       RETURNING application_id`,
      [
        inspectionId,
        data.notes || null,
        JSON.stringify(data.roomDetails || {}),
        data.smokeDetectorOk ?? null,
        data.hqsCompliant ?? null,
        data.followUpRequired ?? false,
        data.followUpNotes || null,
      ]
    );
    if (result.rows.length === 0) throw new Error("Inspection not found");

    await writeAuditLog({
      action: "inspection_completed",
      actorId, actorRole,
      applicationId: result.rows[0].application_id || undefined,
      resourceType: "inspection",
      resourceId: inspectionId,
      details: { smokeDetectorOk: data.smokeDetectorOk, hqsCompliant: data.hqsCompliant, followUpRequired: data.followUpRequired },
    });
  }

  async cancel(inspectionId: string): Promise<void> {
    await query(`UPDATE inspections SET status = 'cancelled' WHERE id = $1`, [inspectionId]);
  }

  async list(filters: {
    propertyId?: string; status?: string; inspectionType?: string;
    limit?: number; offset?: number;
  } = {}, req?: AuthRequest): Promise<{ inspections: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.propertyId) { params.push(filters.propertyId); conditions.push(`i.property_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); conditions.push(`i.status = $${params.length}`); }
    if (filters.inspectionType) { params.push(filters.inspectionType); conditions.push(`i.inspection_type = $${params.length}`); }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "i.property_id");
      if (scope.denyAll) return { inspections: [], total: 0 };
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM inspections i ${where}`, params);
    const dataResult = await query(
      `SELECT i.*, p.name as property_name,
              u.first_name || ' ' || u.last_name as inspector_name
       FROM inspections i
       JOIN properties p ON i.property_id = p.id
       LEFT JOIN users u ON i.inspector_id = u.id
       ${where}
       ORDER BY i.scheduled_date ASC
       LIMIT ${filters.limit || 50} OFFSET ${filters.offset || 0}`,
      params
    );

    return { inspections: dataResult.rows, total: parseInt(countResult.rows[0].count) };
  }

  async getById(id: string, req?: AuthRequest): Promise<any> {
    const conditions = ["i.id = $1"];
    const params: unknown[] = [id];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "i.property_id");
      if (scope.denyAll) return null;
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT i.*, p.name as property_name,
              u.first_name || ' ' || u.last_name as inspector_name
       FROM inspections i
       JOIN properties p ON i.property_id = p.id
       LEFT JOIN users u ON i.inspector_id = u.id
       WHERE ${conditions.join(" AND ")}`,
      params
    );
    return result.rows[0] || null;
  }

  async getOverdue(req?: AuthRequest): Promise<any[]> {
    const conditions = [
      "i.status IN ('scheduled', 'notice_sent')",
      "i.scheduled_date < CURRENT_DATE",
    ];
    const params: unknown[] = [];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "i.property_id");
      if (scope.denyAll) return [];
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT i.*, p.name as property_name
       FROM inspections i JOIN properties p ON i.property_id = p.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.scheduled_date ASC`,
      params
    );
    return result.rows;
  }
}
