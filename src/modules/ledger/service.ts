import { query, transaction } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";
import { AuthRequest } from "../../middleware/auth";
import { buildPropertyScope } from "../../middleware/scope";

// Late fee rules per Master Build List (Module 6)
const GRACE_PERIOD_DAYS = 5;     // Rent due 1st, late on 6th
const BASE_LATE_FEE = 50;        // $50 on Day 6
const DAILY_LATE_FEE = 10;       // +$10/day after Day 6
const MAX_LATE_FEE_DAYS = 30;    // Cap at 30 days
const AUTO_PAY_DISCOUNT = 25;    // $25/month discount for auto-pay
const EVICTION_TRIGGER_COUNT = 4; // 4 late payments in 12 months

export interface LedgerEntryRecord {
  id: string;
  applicationId: string;
  propertyId: string;
  entryType: string;
  status: string;
  description: string;
  amount: number;
  balanceAfter: number;
  billingPeriod: string | null;
  dueDate: string | null;
  referenceId: string | null;
  postedBy: string | null;
  reversedById: string | null;
  notes: string | null;
  createdAt: string;
}

export class LedgerService {
  /**
   * Get running balance for a tenant. When `req` is provided, the lookup is
   * scoped to properties the caller may access; cross-tenant access returns
   * a zeroed balance with `accessible=false` so callers can return 404/empty.
   */
  async getBalance(
    applicationId: string,
    req?: AuthRequest
  ): Promise<{
    applicationId: string;
    balance: number;
    lastPaymentDate: string | null;
    nextDueDate: string | null;
  }> {
    if (req) {
      const scope = buildPropertyScope(req, 2, "a.property_id");
      if (scope.denyAll) {
        return { applicationId, balance: 0, lastPaymentDate: null, nextDueDate: null };
      }
      if (scope.sql) {
        const check = await query(
          `SELECT 1 FROM applications a WHERE a.id = $1 AND ${scope.sql} LIMIT 1`,
          [applicationId, scope.param]
        );
        if (check.rows.length === 0) {
          return { applicationId, balance: 0, lastPaymentDate: null, nextDueDate: null };
        }
      }
    }

    const balResult = await query(
      `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
       WHERE application_id = $1 AND status = 'posted'`,
      [applicationId]
    );

    const lastPayment = await query(
      `SELECT created_at FROM tenant_ledger
       WHERE application_id = $1 AND entry_type = 'payment' AND status = 'posted'
       ORDER BY created_at DESC LIMIT 1`,
      [applicationId]
    );

    const nextDue = await query(
      `SELECT due_date FROM tenant_ledger
       WHERE application_id = $1 AND entry_type = 'rent_charge' AND status = 'posted'
         AND due_date >= CURRENT_DATE
       ORDER BY due_date ASC LIMIT 1`,
      [applicationId]
    );

    return {
      applicationId,
      balance: parseFloat(balResult.rows[0].balance),
      lastPaymentDate: lastPayment.rows[0]?.created_at?.toISOString() || null,
      nextDueDate: nextDue.rows[0]?.due_date?.toISOString()?.split("T")[0] || null,
    };
  }

  /**
   * Get paginated ledger entries for a tenant. When `req` is provided, the
   * application is scoped to properties the caller may access.
   */
  async getLedger(
    applicationId: string,
    filters: { billingPeriod?: string; entryType?: string; limit?: number; offset?: number } = {},
    req?: AuthRequest
  ): Promise<{ entries: LedgerEntryRecord[]; total: number }> {
    if (req) {
      const scope = buildPropertyScope(req, 2, "a.property_id");
      if (scope.denyAll) return { entries: [], total: 0 };
      if (scope.sql) {
        const check = await query(
          `SELECT 1 FROM applications a WHERE a.id = $1 AND ${scope.sql} LIMIT 1`,
          [applicationId, scope.param]
        );
        if (check.rows.length === 0) return { entries: [], total: 0 };
      }
    }

    const conditions = ["l.application_id = $1"];
    const params: unknown[] = [applicationId];

    if (filters.billingPeriod) {
      params.push(filters.billingPeriod);
      conditions.push(`l.billing_period = $${params.length}`);
    }
    if (filters.entryType) {
      params.push(filters.entryType);
      conditions.push(`l.entry_type = $${params.length}`);
    }

    const where = conditions.join(" AND ");
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const countResult = await query(
      `SELECT COUNT(*) FROM tenant_ledger l WHERE ${where}`,
      params
    );
    const dataResult = await query(
      `SELECT * FROM tenant_ledger l WHERE ${where}
       ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return {
      entries: dataResult.rows.map(this.rowToRecord),
      total: parseInt(countResult.rows[0].count),
    };
  }

  /**
   * Post monthly rent charge for a specific tenant.
   */
  async postMonthlyRent(
    applicationId: string,
    billingPeriod: string,
    amount: number,
    postedBy: string,
    postedByRole: string
  ): Promise<LedgerEntryRecord> {
    // Idempotent: check if already posted for this period
    const existing = await query(
      `SELECT id FROM tenant_ledger
       WHERE application_id = $1 AND billing_period = $2 AND entry_type = 'rent_charge' AND status = 'posted'`,
      [applicationId, billingPeriod]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Rent already posted for ${billingPeriod}`);
    }

    const app = await query(
      `SELECT property_id FROM applications WHERE id = $1`,
      [applicationId]
    );
    if (app.rows.length === 0) throw new Error("Application not found");

    const [year, month] = billingPeriod.split("-").map(Number);
    const dueDate = `${billingPeriod}-01`;

    const currentBalance = await this.getBalanceAmount(applicationId);
    const newBalance = currentBalance + amount;

    const result = await query(
      `INSERT INTO tenant_ledger
         (application_id, property_id, entry_type, description, amount, balance_after,
          billing_period, due_date, posted_by)
       VALUES ($1, $2, 'rent_charge', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        applicationId,
        app.rows[0].property_id,
        `Monthly rent — ${billingPeriod}`,
        amount,
        newBalance,
        billingPeriod,
        dueDate,
        postedBy,
      ]
    );

    await writeAuditLog({
      action: "ledger_rent_posted",
      actorId: postedBy,
      actorRole: postedByRole,
      applicationId,
      resourceType: "tenant_ledger",
      resourceId: result.rows[0].id,
      details: { billingPeriod, amount },
    });

    return this.rowToRecord(result.rows[0]);
  }

  /**
   * Record a payment against a tenant's balance.
   *
   * Wrapped in a transaction with an advisory lock keyed on application_id so
   * concurrent writers serialise per-tenant. Without this, two simultaneous
   * payments can both read the same `currentBalance` and write conflicting
   * `balance_after` rows.
   */
  async recordPayment(
    applicationId: string,
    amount: number,
    referenceId: string | null,
    postedBy: string,
    postedByRole: string,
    notes?: string
  ): Promise<LedgerEntryRecord> {
    const record = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ledger:${applicationId}`,
      ]);

      const app = await client.query(
        `SELECT property_id FROM applications WHERE id = $1`,
        [applicationId]
      );
      if (app.rows.length === 0) throw new Error("Application not found");

      const balRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
         WHERE application_id = $1 AND status = 'posted'`,
        [applicationId]
      );
      const currentBalance = parseFloat(balRes.rows[0].balance);
      const newBalance = currentBalance - amount;
      const now = new Date();
      const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const insert = await client.query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, reference_id, posted_by, notes)
         VALUES ($1, $2, 'payment', $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          applicationId,
          app.rows[0].property_id,
          `Payment received`,
          -amount, // Negative = reduces balance
          newBalance,
          billingPeriod,
          referenceId || null,
          postedBy,
          notes || null,
        ]
      );

      return insert.rows[0];
    });

    await writeAuditLog({
      action: "ledger_payment_recorded",
      actorId: postedBy,
      actorRole: postedByRole,
      applicationId,
      resourceType: "tenant_ledger",
      resourceId: record.id,
      details: { amount, referenceId },
    });

    return this.rowToRecord(record);
  }

  /**
   * Apply a credit (concession, adjustment, auto-pay discount).
   *
   * Transactional + advisory-locked per application_id (see recordPayment).
   */
  async applyCredit(
    applicationId: string,
    amount: number,
    description: string,
    postedBy: string,
    postedByRole: string
  ): Promise<LedgerEntryRecord> {
    const record = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ledger:${applicationId}`,
      ]);

      const app = await client.query(
        `SELECT property_id FROM applications WHERE id = $1`,
        [applicationId]
      );
      if (app.rows.length === 0) throw new Error("Application not found");

      const balRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
         WHERE application_id = $1 AND status = 'posted'`,
        [applicationId]
      );
      const currentBalance = parseFloat(balRes.rows[0].balance);
      const newBalance = currentBalance - amount;
      const now = new Date();
      const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const insert = await client.query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, posted_by)
         VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7)
         RETURNING *`,
        [applicationId, app.rows[0].property_id, description, -amount, newBalance, billingPeriod, postedBy]
      );

      return insert.rows[0];
    });

    await writeAuditLog({
      action: "ledger_credit_applied",
      actorId: postedBy,
      actorRole: postedByRole,
      applicationId,
      resourceType: "tenant_ledger",
      resourceId: record.id,
      details: { amount, description },
    });

    return this.rowToRecord(record);
  }

  /**
   * Post a manual charge (e.g. extended guest fee, early termination).
   *
   * Transactional + advisory-locked per application_id (see recordPayment).
   */
  async postCharge(
    applicationId: string,
    entryType: string,
    amount: number,
    description: string,
    postedBy: string,
    postedByRole: string
  ): Promise<LedgerEntryRecord> {
    const record = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ledger:${applicationId}`,
      ]);

      const app = await client.query(
        `SELECT property_id FROM applications WHERE id = $1`,
        [applicationId]
      );
      if (app.rows.length === 0) throw new Error("Application not found");

      const balRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
         WHERE application_id = $1 AND status = 'posted'`,
        [applicationId]
      );
      const currentBalance = parseFloat(balRes.rows[0].balance);
      const newBalance = currentBalance + amount;
      const now = new Date();
      const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

      const insert = await client.query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, posted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [applicationId, app.rows[0].property_id, entryType, description, amount, newBalance, billingPeriod, postedBy]
      );

      return insert.rows[0];
    });

    return this.rowToRecord(record);
  }

  /**
   * Reverse a ledger entry (creates offsetting entry, never deletes).
   *
   * Transactional + advisory-locked per application_id so concurrent reversals
   * cannot double-flip status or compute stale balances.
   */
  async reverseEntry(
    entryId: string,
    reason: string,
    postedBy: string,
    postedByRole: string
  ): Promise<LedgerEntryRecord> {
    // Resolve the application first so we can lock on it.
    const lookup = await query(`SELECT application_id FROM tenant_ledger WHERE id = $1`, [entryId]);
    if (lookup.rows.length === 0) throw new Error("Ledger entry not found");
    const applicationId: string = lookup.rows[0].application_id;

    const { record, origAppId } = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ledger:${applicationId}`,
      ]);

      // Re-fetch + lock the original row inside the txn.
      const original = await client.query(
        `SELECT * FROM tenant_ledger WHERE id = $1 FOR UPDATE`,
        [entryId]
      );
      if (original.rows.length === 0) throw new Error("Ledger entry not found");
      if (original.rows[0].status === "reversed") throw new Error("Entry already reversed");

      const orig = original.rows[0];

      const balRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
         WHERE application_id = $1 AND status = 'posted'`,
        [orig.application_id]
      );
      const currentBalance = parseFloat(balRes.rows[0].balance);
      const newBalance = currentBalance - parseFloat(orig.amount);

      // Mark original as reversed
      await client.query(`UPDATE tenant_ledger SET status = 'reversed' WHERE id = $1`, [entryId]);

      // Create offsetting entry
      const insert = await client.query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, status, description, amount, balance_after,
            billing_period, reversed_by_id, posted_by, notes)
         VALUES ($1, $2, $3, 'posted', $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          orig.application_id,
          orig.property_id,
          orig.entry_type,
          `REVERSAL: ${orig.description}`,
          -parseFloat(orig.amount),
          newBalance,
          orig.billing_period,
          entryId,
          postedBy,
          reason,
        ]
      );

      return { record: insert.rows[0], origAppId: orig.application_id as string };
    });

    await writeAuditLog({
      action: "ledger_entry_reversed",
      actorId: postedBy,
      actorRole: postedByRole,
      applicationId: origAppId,
      resourceType: "tenant_ledger",
      resourceId: record.id,
      details: { originalEntryId: entryId, reason },
    });

    return this.rowToRecord(record);
  }

  /**
   * Delinquency report: all tenants with positive balance, grouped by aging.
   */
  async getDelinquencyReport(
    propertyId?: string,
    req?: AuthRequest
  ): Promise<{
    delinquencies: Array<{
      applicationId: string;
      tenantName: string;
      propertyName: string;
      balance: number;
      oldestUnpaidDate: string | null;
      daysOverdue: number;
      latePaymentCount12Mo: number;
      evictionTrigger: boolean;
    }>;
  }> {
    const conditions: string[] = ["a.status = 'onboarded'"];
    const params: unknown[] = [];

    if (propertyId) {
      params.push(propertyId);
      conditions.push(`a.property_id = $${params.length}`);
    }

    if (req) {
      const scope = buildPropertyScope(req, params.length + 1, "a.property_id");
      if (scope.denyAll) return { delinquencies: [] };
      if (scope.sql) {
        conditions.push(scope.sql);
        params.push(scope.param);
      }
    }

    const where = conditions.join(" AND ");

    const result = await query(
      `SELECT
         a.id as application_id,
         a.first_name || ' ' || a.last_name as tenant_name,
         p.name as property_name,
         COALESCE(SUM(l.amount), 0) as balance,
         MIN(CASE WHEN l.entry_type = 'rent_charge' AND l.amount > 0
             THEN l.due_date END) as oldest_unpaid_date
       FROM applications a
       JOIN properties p ON a.property_id = p.id
       LEFT JOIN tenant_ledger l ON a.id = l.application_id AND l.status = 'posted'
       WHERE ${where}
       GROUP BY a.id, a.first_name, a.last_name, p.name
       HAVING COALESCE(SUM(l.amount), 0) > 0
       ORDER BY COALESCE(SUM(l.amount), 0) DESC`,
      params
    );

    const delinquencies = [];
    for (const row of result.rows) {
      const balance = parseFloat(row.balance);
      const oldestDate = row.oldest_unpaid_date;
      const daysOverdue = oldestDate
        ? Math.max(0, Math.ceil((Date.now() - new Date(oldestDate).getTime()) / 86400000))
        : 0;

      // Count late fees in rolling 12 months
      const lateResult = await query(
        `SELECT COUNT(*) FROM tenant_ledger
         WHERE application_id = $1 AND entry_type = 'late_fee' AND status = 'posted'
           AND created_at >= (CURRENT_DATE - INTERVAL '12 months')`,
        [row.application_id]
      );
      const lateCount = parseInt(lateResult.rows[0].count);

      delinquencies.push({
        applicationId: row.application_id,
        tenantName: row.tenant_name,
        propertyName: row.property_name,
        balance,
        oldestUnpaidDate: oldestDate?.toISOString?.()?.split("T")[0] || null,
        daysOverdue,
        latePaymentCount12Mo: lateCount,
        evictionTrigger: lateCount >= EVICTION_TRIGGER_COUNT,
      });
    }

    return { delinquencies };
  }

  /**
   * Process monthly rent postings for all active tenants.
   * Called by scheduler on the 1st of each month.
   */
  async processMonthlyRentPostings(): Promise<{ posted: number; skipped: number }> {
    const now = new Date();
    const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const tenants = await query(
      `SELECT a.id, a.requested_rent_amount, a.auto_pay_enrolled, a.property_id
       FROM applications a
       WHERE a.status = 'onboarded' AND a.lease_start_date IS NOT NULL
         AND a.requested_rent_amount IS NOT NULL`
    );

    let posted = 0;
    let skipped = 0;

    for (const tenant of tenants.rows) {
      // Check if already posted (idempotent)
      const existing = await query(
        `SELECT id FROM tenant_ledger
         WHERE application_id = $1 AND billing_period = $2 AND entry_type = 'rent_charge' AND status = 'posted'`,
        [tenant.id, billingPeriod]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      const rentAmount = parseFloat(tenant.requested_rent_amount);
      const currentBalance = await this.getBalanceAmount(tenant.id);
      const dueDate = `${billingPeriod}-01`;

      await query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, due_date, posted_by)
         VALUES ($1, $2, 'rent_charge', $3, $4, $5, $6, $7, NULL)`,
        [
          tenant.id,
          tenant.property_id,
          `Monthly rent — ${billingPeriod}`,
          rentAmount,
          currentBalance + rentAmount,
          billingPeriod,
          dueDate,
        ]
      );

      // Apply auto-pay discount if enrolled
      if (tenant.auto_pay_enrolled) {
        const afterRent = currentBalance + rentAmount;
        await query(
          `INSERT INTO tenant_ledger
             (application_id, property_id, entry_type, description, amount, balance_after,
              billing_period, posted_by)
           VALUES ($1, $2, 'concession', $3, $4, $5, $6, NULL)`,
          [
            tenant.id,
            tenant.property_id,
            `Auto-pay discount — ${billingPeriod}`,
            -AUTO_PAY_DISCOUNT,
            afterRent - AUTO_PAY_DISCOUNT,
            billingPeriod,
          ]
        );
      }

      posted++;
    }

    logger.info("Monthly rent postings complete", { billingPeriod, posted, skipped });
    return { posted, skipped };
  }

  /**
   * Process late fees for all overdue rent charges.
   * Called daily by scheduler (effective from 6th of month onward).
   */
  async processLateFees(): Promise<{ assessed: number; skipped: number }> {
    const now = new Date();
    let assessed = 0;
    let skipped = 0;

    // Find unpaid rent charges past grace period
    const unpaid = await query(
      `SELECT l.id, l.application_id, l.property_id, l.amount, l.billing_period, l.due_date,
              (SELECT COALESCE(SUM(amount), 0) FROM tenant_ledger
               WHERE application_id = l.application_id AND billing_period = l.billing_period
                 AND entry_type = 'payment' AND status = 'posted') as payments_for_period
       FROM tenant_ledger l
       WHERE l.entry_type = 'rent_charge' AND l.status = 'posted'
         AND l.due_date < (CURRENT_DATE - INTERVAL '${GRACE_PERIOD_DAYS} days')
       ORDER BY l.due_date ASC`
    );

    for (const charge of unpaid.rows) {
      const rentAmount = parseFloat(charge.amount);
      const paidForPeriod = Math.abs(parseFloat(charge.payments_for_period));

      // Skip if fully paid for this period
      if (paidForPeriod >= rentAmount) {
        skipped++;
        continue;
      }

      // Check if late fee already assessed for this billing period
      const existingFee = await query(
        `SELECT id FROM tenant_ledger
         WHERE application_id = $1 AND billing_period = $2 AND entry_type = 'late_fee' AND status = 'posted'`,
        [charge.application_id, charge.billing_period]
      );

      if (existingFee.rows.length > 0) {
        skipped++;
        continue;
      }

      // Calculate late fee: $50 on Day 6, +$10/day after
      const dueDate = new Date(charge.due_date);
      const daysLate = Math.ceil((now.getTime() - dueDate.getTime()) / 86400000) - GRACE_PERIOD_DAYS;
      if (daysLate <= 0) { skipped++; continue; }

      const cappedDays = Math.min(daysLate, MAX_LATE_FEE_DAYS);
      const fee = BASE_LATE_FEE + Math.max(0, cappedDays - 1) * DAILY_LATE_FEE;

      const currentBalance = await this.getBalanceAmount(charge.application_id);

      await query(
        `INSERT INTO tenant_ledger
           (application_id, property_id, entry_type, description, amount, balance_after,
            billing_period, posted_by)
         VALUES ($1, $2, 'late_fee', $3, $4, $5, $6, NULL)`,
        [
          charge.application_id,
          charge.property_id,
          `Late fee — ${charge.billing_period} (${daysLate} days late)`,
          fee,
          currentBalance + fee,
          charge.billing_period,
        ]
      );

      assessed++;
    }

    logger.info("Late fee processing complete", { assessed, skipped });
    return { assessed, skipped };
  }

  private async getBalanceAmount(applicationId: string): Promise<number> {
    const result = await query(
      `SELECT COALESCE(SUM(amount), 0) as balance FROM tenant_ledger
       WHERE application_id = $1 AND status = 'posted'`,
      [applicationId]
    );
    return parseFloat(result.rows[0].balance);
  }

  private rowToRecord(row: any): LedgerEntryRecord {
    return {
      id: row.id,
      applicationId: row.application_id,
      propertyId: row.property_id,
      entryType: row.entry_type,
      status: row.status,
      description: row.description,
      amount: parseFloat(row.amount),
      balanceAfter: parseFloat(row.balance_after),
      billingPeriod: row.billing_period || null,
      dueDate: row.due_date?.toISOString?.()?.split("T")[0] || row.due_date || null,
      referenceId: row.reference_id || null,
      postedBy: row.posted_by || null,
      reversedById: row.reversed_by_id || null,
      notes: row.notes || null,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
    };
  }
}
