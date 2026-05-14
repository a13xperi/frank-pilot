import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope } from "../../middleware/scope";

// Emergency categories per Master Build List
const EMERGENCY_CATEGORIES = new Set([
  "plumbing_leak", "frozen_pipes", "no_heat", "electrical_failure",
  "gas_leak", "flooding", "fire_damage", "lock_change_safety",
]);

export class MaintenanceService {
  async createWorkOrder(
    propertyId: string,
    title: string,
    description: string,
    priority: string,
    actorId: string,
    actorRole: string,
    unitNumber?: string,
    applicationId?: string,
    category?: string
  ): Promise<{ id: string }> {
    const isEmergency = priority === "emergency" || (category && EMERGENCY_CATEGORIES.has(category));

    const result = await query(
      `INSERT INTO work_orders
         (property_id, application_id, unit_number, title, description,
          priority, category, is_emergency, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [propertyId, applicationId || null, unitNumber || null, title, description,
       isEmergency ? "emergency" : priority, category || null, isEmergency, actorId]
    );

    await writeAuditLog({
      action: "work_order_created",
      actorId, actorRole,
      applicationId: applicationId || undefined,
      resourceType: "work_order",
      resourceId: result.rows[0].id,
      details: { propertyId, title, priority, isEmergency, category },
    });

    if (isEmergency) {
      logger.warn("EMERGENCY work order created", { workOrderId: result.rows[0].id, title, propertyId });
    }

    return { id: result.rows[0].id };
  }

  async assign(workOrderId: string, assignedTo: string, actorId: string, actorRole: string): Promise<void> {
    const result = await query(
      `UPDATE work_orders SET assigned_to = $2, assigned_at = NOW(), status = 'assigned'
       WHERE id = $1 RETURNING application_id`,
      [workOrderId, assignedTo]
    );
    if (result.rows.length === 0) throw new Error("Work order not found");

    await writeAuditLog({
      action: "work_order_assigned",
      actorId, actorRole,
      applicationId: result.rows[0].application_id || undefined,
      resourceType: "work_order",
      resourceId: workOrderId,
      details: { assignedTo },
    });
  }

  async startWork(workOrderId: string): Promise<void> {
    await query(
      `UPDATE work_orders SET status = 'in_progress', started_at = NOW() WHERE id = $1`,
      [workOrderId]
    );
  }

  async complete(
    workOrderId: string,
    actorId: string,
    actorRole: string,
    notes: string,
    actualCost?: number
  ): Promise<void> {
    const result = await query(
      `UPDATE work_orders SET status = 'completed', completed_at = NOW(), completed_by = $2,
         completion_notes = $3, actual_cost = $4
       WHERE id = $1 RETURNING application_id`,
      [workOrderId, actorId, notes, actualCost || null]
    );
    if (result.rows.length === 0) throw new Error("Work order not found");

    await writeAuditLog({
      action: "work_order_completed",
      actorId, actorRole,
      applicationId: result.rows[0].application_id || undefined,
      resourceType: "work_order",
      resourceId: workOrderId,
      details: { notes, actualCost },
    });
  }

  async cancel(workOrderId: string): Promise<void> {
    await query(`UPDATE work_orders SET status = 'cancelled' WHERE id = $1`, [workOrderId]);
  }

  async list(filters: {
    propertyId?: string; status?: string; priority?: string; isEmergency?: boolean;
    limit?: number; offset?: number;
  } = {}, req?: AuthRequest): Promise<{ workOrders: any[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.propertyId) { params.push(filters.propertyId); conditions.push(`w.property_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); conditions.push(`w.status = $${params.length}`); }
    if (filters.priority) { params.push(filters.priority); conditions.push(`w.priority = $${params.length}`); }
    if (filters.isEmergency !== undefined) { params.push(filters.isEmergency); conditions.push(`w.is_emergency = $${params.length}`); }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "w.property_id");
      if (scope.denyAll) return { workOrders: [], total: 0 };
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await query(`SELECT COUNT(*) FROM work_orders w ${where}`, params);
    const dataResult = await query(
      `SELECT w.*, p.name as property_name,
              sub.first_name || ' ' || sub.last_name as submitted_by_name,
              asgn.first_name || ' ' || asgn.last_name as assigned_to_name
       FROM work_orders w
       JOIN properties p ON w.property_id = p.id
       LEFT JOIN users sub ON w.submitted_by = sub.id
       LEFT JOIN users asgn ON w.assigned_to = asgn.id
       ${where}
       ORDER BY
         CASE w.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 WHEN 'routine' THEN 2 ELSE 3 END,
         w.created_at DESC
       LIMIT ${filters.limit || 50} OFFSET ${filters.offset || 0}`,
      params
    );

    return { workOrders: dataResult.rows, total: parseInt(countResult.rows[0].count) };
  }

  async getById(id: string, req?: AuthRequest): Promise<any> {
    const conditions = ["w.id = $1"];
    const params: unknown[] = [id];
    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "w.property_id");
      if (scope.denyAll) return null;
      if (scope.sql) { conditions.push(scope.sql); params.push(scope.param); }
    }
    const result = await query(
      `SELECT w.*, p.name as property_name,
              sub.first_name || ' ' || sub.last_name as submitted_by_name,
              asgn.first_name || ' ' || asgn.last_name as assigned_to_name
       FROM work_orders w
       JOIN properties p ON w.property_id = p.id
       LEFT JOIN users sub ON w.submitted_by = sub.id
       LEFT JOIN users asgn ON w.assigned_to = asgn.id
       WHERE ${conditions.join(" AND ")}`,
      params
    );
    return result.rows[0] || null;
  }
}
