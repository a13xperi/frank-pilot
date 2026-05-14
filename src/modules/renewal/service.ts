import { query } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { TwilioService } from "../integrations/twilio";

export class LeaseRenewalService {
  private twilio = new TwilioService();

  async generateOffer(
    applicationId: string,
    proposedRent: number,
    proposedTermMonths: number,
    actorId: string,
    actorRole: string
  ): Promise<{ id: string }> {
    const app = await query(
      `SELECT a.id, a.property_id, a.requested_rent_amount, a.lease_end_date,
              a.first_name, a.last_name, a.phone
       FROM applications a WHERE a.id = $1 AND a.status = 'onboarded'`,
      [applicationId]
    );
    if (app.rows.length === 0) throw new Error("Onboarded application not found");
    const a = app.rows[0];

    const currentRent = parseFloat(a.requested_rent_amount || "0");
    const changeAmount = proposedRent - currentRent;
    const leaseEnd = a.lease_end_date ? new Date(a.lease_end_date) : null;
    const responseDeadline = leaseEnd
      ? new Date(leaseEnd.getTime() - 30 * 86400000).toISOString().split("T")[0]
      : null;

    const result = await query(
      `INSERT INTO lease_renewals
         (application_id, property_id, status, current_rent, proposed_rent,
          rent_change_amount, proposed_term_months, offered_at, response_deadline)
       VALUES ($1, $2, 'offered', $3, $4, $5, $6, NOW(), $7)
       RETURNING id`,
      [applicationId, a.property_id, currentRent, proposedRent, changeAmount, proposedTermMonths, responseDeadline]
    );

    await writeAuditLog({
      action: "renewal_offered",
      actorId, actorRole, applicationId,
      resourceType: "lease_renewal",
      resourceId: result.rows[0].id,
      details: { currentRent, proposedRent, changeAmount, proposedTermMonths },
    });

    if (a.phone) {
      this.twilio.sendSMS(a.phone,
        `${a.first_name} ${a.last_name}: Your lease renewal offer is ready. Proposed rent: $${proposedRent}/mo (${changeAmount >= 0 ? "+" : ""}$${changeAmount}). Please respond by ${responseDeadline || "30 days before lease end"}.`
      ).catch(() => {});
    }

    return { id: result.rows[0].id };
  }

  async respond(
    renewalId: string,
    response: "accept" | "decline" | "counter",
    actorId: string,
    actorRole: string,
    counterRent?: number,
    counterTermMonths?: number
  ): Promise<void> {
    const statusMap: Record<string, string> = { accept: "accepted", decline: "declined", counter: "counter_offered" };
    const auditMap: Record<string, string> = { accept: "renewal_accepted", decline: "renewal_declined", counter: "renewal_counter_offered" };

    const result = await query(
      `UPDATE lease_renewals
       SET status = $2, tenant_response = $3, response_at = NOW(),
           counter_rent = $4, counter_term_months = $5
       WHERE id = $1 AND status IN ('offered', 'counter_offered')
       RETURNING id, application_id`,
      [renewalId, statusMap[response], response, counterRent || null, counterTermMonths || null]
    );
    if (result.rows.length === 0) throw new Error("Renewal not found or not in respondable state");

    await writeAuditLog({
      action: auditMap[response] as any,
      actorId, actorRole,
      applicationId: result.rows[0].application_id,
      resourceType: "lease_renewal",
      resourceId: renewalId,
      details: { response, counterRent, counterTermMonths },
    });
  }

  async approve(renewalId: string, actorId: string, actorRole: string): Promise<void> {
    const renewal = await query(
      `SELECT r.*, a.lease_end_date, a.requested_rent_amount
       FROM lease_renewals r JOIN applications a ON r.application_id = a.id
       WHERE r.id = $1 AND r.status IN ('accepted', 'counter_offered')`,
      [renewalId]
    );
    if (renewal.rows.length === 0) throw new Error("Renewal not found or not approvable");

    const r = renewal.rows[0];
    const finalRent = r.status === "counter_offered" && r.counter_rent ? parseFloat(r.counter_rent) : parseFloat(r.proposed_rent);
    const termMonths = r.status === "counter_offered" && r.counter_term_months ? r.counter_term_months : r.proposed_term_months;

    // Extend lease
    const currentEnd = r.lease_end_date ? new Date(r.lease_end_date) : new Date();
    const newEnd = new Date(currentEnd);
    newEnd.setMonth(newEnd.getMonth() + termMonths);

    await query(
      `UPDATE applications SET lease_end_date = $2, requested_rent_amount = $3 WHERE id = $1`,
      [r.application_id, newEnd.toISOString().split("T")[0], finalRent]
    );

    await query(
      `UPDATE lease_renewals SET status = 'approved', approved_by = $2, approved_at = NOW() WHERE id = $1`,
      [renewalId, actorId]
    );

    await writeAuditLog({
      action: "renewal_approved",
      actorId, actorRole,
      applicationId: r.application_id,
      resourceType: "lease_renewal",
      resourceId: renewalId,
      details: { finalRent, termMonths, newLeaseEnd: newEnd.toISOString().split("T")[0] },
    });
  }

  async processRenewalOffers(): Promise<{ generated: number; reminded: number }> {
    let generated = 0;
    let reminded = 0;

    // Auto-generate offers for leases ending within 90 days
    const upcoming = await query(
      `SELECT a.id, a.property_id, a.requested_rent_amount, a.lease_end_date,
              a.first_name, a.last_name, a.phone
       FROM applications a
       WHERE a.status = 'onboarded' AND a.lease_end_date IS NOT NULL
         AND a.lease_end_date <= (CURRENT_DATE + INTERVAL '90 days')
         AND a.lease_end_date > CURRENT_DATE
         AND NOT EXISTS (
           SELECT 1 FROM lease_renewals lr
           WHERE lr.application_id = a.id AND lr.status NOT IN ('expired', 'declined')
         )`
    );

    for (const app of upcoming.rows) {
      const currentRent = parseFloat(app.requested_rent_amount || "0");
      const proposedRent = Math.round(currentRent * 1.03 * 100) / 100; // 3% increase

      await query(
        `INSERT INTO lease_renewals
           (application_id, property_id, status, current_rent, proposed_rent,
            rent_change_amount, proposed_term_months, offered_at, response_deadline)
         VALUES ($1, $2, 'offered', $3, $4, $5, 12, NOW(), $6)`,
        [app.id, app.property_id, currentRent, proposedRent, proposedRent - currentRent,
         new Date(new Date(app.lease_end_date).getTime() - 30 * 86400000).toISOString().split("T")[0]]
      );

      if (app.phone) {
        this.twilio.sendSMS(app.phone,
          `${app.first_name} ${app.last_name}: Your lease is up for renewal. Current rent: $${currentRent}/mo, proposed: $${proposedRent}/mo. Contact your property manager to discuss.`
        ).catch(() => {});
      }
      generated++;
    }

    // Send reminders for unresponded offers
    const unresponded = await query(
      `SELECT lr.*, a.phone, a.first_name, a.last_name
       FROM lease_renewals lr JOIN applications a ON lr.application_id = a.id
       WHERE lr.status = 'offered' AND lr.response_deadline IS NOT NULL`
    );

    const now = new Date();
    for (const r of unresponded.rows) {
      const deadline = new Date(r.response_deadline);
      const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / 86400000);

      if (daysUntil <= 30 && !r.reminder_30_sent_at) {
        await query(`UPDATE lease_renewals SET reminder_30_sent_at = NOW() WHERE id = $1`, [r.id]);
        if (r.phone) {
          this.twilio.sendSMS(r.phone, `FINAL NOTICE — ${r.first_name} ${r.last_name}: Your lease renewal response is due in ${daysUntil} days. If no response, your lease will not be renewed.`).catch(() => {});
        }
        reminded++;
      } else if (daysUntil <= 60 && !r.reminder_60_sent_at) {
        await query(`UPDATE lease_renewals SET reminder_60_sent_at = NOW() WHERE id = $1`, [r.id]);
        if (r.phone) {
          this.twilio.sendSMS(r.phone, `REMINDER — ${r.first_name} ${r.last_name}: Please respond to your lease renewal offer. Deadline: ${deadline.toLocaleDateString()}.`).catch(() => {});
        }
        reminded++;
      }
    }

    logger.info("Renewal offer processing complete", { generated, reminded });
    return { generated, reminded };
  }

  async list(filters: { status?: string; propertyId?: string } = {}): Promise<any[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.status) { params.push(filters.status); conditions.push(`lr.status = $${params.length}`); }
    if (filters.propertyId) { params.push(filters.propertyId); conditions.push(`lr.property_id = $${params.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT lr.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name
       FROM lease_renewals lr
       JOIN applications a ON lr.application_id = a.id
       JOIN properties p ON lr.property_id = p.id
       ${where} ORDER BY lr.created_at DESC`,
      params
    );
    return result.rows;
  }

  async getById(id: string): Promise<any> {
    const result = await query(
      `SELECT lr.*, a.first_name || ' ' || a.last_name as tenant_name, p.name as property_name,
              a.lease_end_date
       FROM lease_renewals lr
       JOIN applications a ON lr.application_id = a.id
       JOIN properties p ON lr.property_id = p.id
       WHERE lr.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }
}
