/**
 * DM-FRANK-024 Accounts Payable — service layer (the 023-independent core).
 *
 * Money OUT, mirroring the structure of the rent LedgerService. Encodes the
 * operator's real control: nobody pays a bill alone (separation of duties:
 * cutter ≠ reviewer ≠ signer), Frank Hawkins's signature is a recorded WET
 * signature (never an e-sign), and every transition is stamped on the
 * property-scoped hash-chained tape + the audit log. Corrections are
 * append-only: a check is voided and a NEW check is reissued referencing it.
 *
 * The disbursement SINK (RealPage push vs in-platform print) is injected and
 * selected by DM-FRANK-023 — the only decision-dependent seam.
 */

import { query, transaction } from "../../config/database";
import { writeAuditLog } from "../../middleware/audit";
import { enforceSeparationOfDuties } from "../../middleware/rbac";
import type { PoolClient } from "pg";
import { stampV2Ap } from "../tape/v2-stamp";
import { nextState, type ApCheckState } from "./state-machine";
import {
  selectDisbursementSink,
  type DisbursementSink,
} from "./sinks";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ApVendorRecord {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface ApInvoiceRecord {
  id: string;
  vendorId: string;
  propertyId: string;
  unitId: string | null;
  amountCents: number;
  invoiceNumber: string | null;
  billingNumber: string | null;
  unitNumber: string | null;
  dueDate: string | null;
  receivedVia: string;
  status: string;
  createdAt: string;
}

export interface ApCheckRecord {
  id: string;
  checkRunId: string;
  invoiceId: string;
  amountCents: number;
  checkNumber: string | null;
  state: ApCheckState;
  cutBy: string | null;
  reviewedBy: string | null;
  signedBy: string | null;
  voidedBy: string | null;
  reissuedFromCheckId: string | null;
  disbursementRef: string | null;
  createdAt: string;
}

interface CheckRow {
  id: string;
  check_run_id: string;
  invoice_id: string;
  amount_cents: string | number;
  check_number: string | null;
  state: ApCheckState;
  cut_by: string | null;
  reviewed_by: string | null;
  signed_by: string | null;
  voided_by: string | null;
  reissued_from_check_id: string | null;
  disbursement_ref: string | null;
  created_at: Date | string;
  // joined from ap_invoices
  property_id?: string;
  invoice_number?: string | null;
  billing_number?: string | null;
  unit_number?: string | null;
}

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

export class ApService {
  constructor(private readonly sink: DisbursementSink = selectDisbursementSink()) {}

  // -------------------------------------------------------------------------
  // Vendors
  // -------------------------------------------------------------------------
  async registerVendor(
    input: { name: string; address?: string; phone?: string; taxId?: string },
    actor: { id: string; role: string },
  ): Promise<ApVendorRecord> {
    const result = await query(
      `INSERT INTO ap_vendors (name, address, phone, tax_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.name, input.address ?? null, input.phone ?? null, input.taxId ?? null, actor.id],
    );
    const row = result.rows[0];

    await writeAuditLog({
      action: "ap_vendor_registered",
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: "ap_vendors",
      resourceId: row.id,
      details: { name: input.name, hasTaxId: Boolean(input.taxId) }, // never log the tax id
    });
    // Vendor master is portfolio-wide → global tape chain (no single property).
    await stampV2Ap("AP_VENDOR_REGISTERED", null, {
      actorId: actor.id,
      subjectId: row.id,
      evidence: { name: input.name },
    });

    return this.rowToVendor(row);
  }

  async listVendors(activeOnly = false): Promise<ApVendorRecord[]> {
    const result = await query(
      `SELECT * FROM ap_vendors ${activeOnly ? "WHERE is_active = TRUE" : ""} ORDER BY name ASC`,
    );
    return result.rows.map((r) => this.rowToVendor(r));
  }

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------
  async captureInvoice(
    input: {
      vendorId: string;
      propertyId: string;
      unitId?: string | null;
      amountCents: number;
      invoiceNumber?: string | null;
      billingNumber?: string | null;
      unitNumber?: string | null;
      dueDate?: string | null;
      receivedVia: string;
    },
    actor: { id: string; role: string },
  ): Promise<ApInvoiceRecord> {
    const result = await query(
      `INSERT INTO ap_invoices
         (vendor_id, property_id, unit_id, amount_cents, invoice_number,
          billing_number, unit_number, due_date, received_via, status, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'entered',$10) RETURNING *`,
      [
        input.vendorId,
        input.propertyId,
        input.unitId ?? null,
        input.amountCents,
        input.invoiceNumber ?? null,
        input.billingNumber ?? null,
        input.unitNumber ?? null,
        input.dueDate ?? null,
        input.receivedVia,
        actor.id,
      ],
    );
    const row = result.rows[0];

    await writeAuditLog({
      action: "ap_invoice_captured",
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: "ap_invoices",
      resourceId: row.id,
      details: { vendorId: input.vendorId, amountCents: input.amountCents },
    });
    await stampV2Ap("AP_INVOICE_CAPTURED", input.propertyId, {
      actorId: actor.id,
      subjectId: row.id,
      evidence: {
        vendorId: input.vendorId,
        amountCents: input.amountCents,
        invoiceNumber: input.invoiceNumber ?? null,
        billingNumber: input.billingNumber ?? null,
        unitNumber: input.unitNumber ?? null,
      },
    });

    return this.rowToInvoice(row);
  }

  async listInvoices(filters: {
    propertyId?: string;
    status?: string;
    dueBefore?: string;
  }): Promise<ApInvoiceRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.propertyId) {
      params.push(filters.propertyId);
      conditions.push(`property_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.dueBefore) {
      params.push(filters.dueBefore);
      conditions.push(`due_date <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `SELECT * FROM ap_invoices ${where} ORDER BY due_date ASC NULLS LAST, created_at ASC`,
      params,
    );
    return result.rows.map((r) => this.rowToInvoice(r));
  }

  // -------------------------------------------------------------------------
  // Check runs + cut
  // -------------------------------------------------------------------------
  async openCheckRun(
    input: { propertyId: string; bankAccountRef: string; weekOf: string },
    actor: { id: string; role: string },
  ): Promise<{ id: string; status: string }> {
    const result = await query(
      `INSERT INTO ap_check_runs (property_id, bank_account_ref, week_of, status, cut_by)
       VALUES ($1, $2, $3, 'open', $4) RETURNING id, status`,
      [input.propertyId, input.bankAccountRef, input.weekOf, actor.id],
    );
    return result.rows[0];
  }

  /** Cut a check for an invoice into a run (Tee). Creates the check at state 'cut'. */
  async cutCheck(
    input: { checkRunId: string; invoiceId: string; checkNumber?: string | null },
    actor: { id: string; role: string },
  ): Promise<ApCheckRecord> {
    const check = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `ap:invoice:${input.invoiceId}`,
      ]);

      const inv = await client.query(
        `SELECT id, property_id, amount_cents, status FROM ap_invoices WHERE id = $1`,
        [input.invoiceId],
      );
      if (inv.rows.length === 0) throw new Error("Invoice not found");
      if (!["entered", "cut"].includes(inv.rows[0].status)) {
        throw new Error(`Invoice is '${inv.rows[0].status}', not cuttable`);
      }

      const run = await client.query(
        `SELECT id, status, property_id FROM ap_check_runs WHERE id = $1`,
        [input.checkRunId],
      );
      if (run.rows.length === 0) throw new Error("Check run not found");
      if (run.rows[0].status !== "open") throw new Error("Check run is closed");
      if (run.rows[0].property_id !== inv.rows[0].property_id) {
        throw new Error("Invoice property does not match the check run's property");
      }

      const ins = await client.query(
        `INSERT INTO ap_checks (check_run_id, invoice_id, amount_cents, check_number, state, cut_by)
         VALUES ($1, $2, $3, $4, 'cut', $5) RETURNING *`,
        [input.checkRunId, input.invoiceId, inv.rows[0].amount_cents, input.checkNumber ?? null, actor.id],
      );
      await client.query(`UPDATE ap_invoices SET status = 'cut', updated_at = NOW() WHERE id = $1`, [
        input.invoiceId,
      ]);
      return { ...ins.rows[0], property_id: inv.rows[0].property_id };
    });

    await this.stampAndAudit("AP_CHECK_CUT", "ap_check_cut", check, actor, {});
    return this.rowToCheck(check);
  }

  // -------------------------------------------------------------------------
  // Approval chain — review (Nancy), sign (Hawkins)
  // -------------------------------------------------------------------------
  async reviewCheck(
    checkId: string,
    decision: "approve" | "reject",
    notes: string | undefined,
    actor: { id: string; role: string },
  ): Promise<ApCheckRecord> {
    return this.decide(checkId, "review", decision, notes, actor);
  }

  async signCheck(
    checkId: string,
    decision: "approve" | "reject",
    notes: string | undefined,
    actor: { id: string; role: string },
  ): Promise<ApCheckRecord> {
    return this.decide(checkId, "sign", decision, notes, actor);
  }

  /** Shared review/sign path: separation-of-duties + state transition + approval row. */
  private async decide(
    checkId: string,
    step: "review" | "sign",
    decision: "approve" | "reject",
    notes: string | undefined,
    actor: { id: string; role: string },
  ): Promise<ApCheckRecord> {
    const action = decision === "approve" ? step : "reject";
    const check = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ap:check:${checkId}`]);
      const cur = await this.loadCheck(client, checkId);

      // Separation of duties: reviewer ≠ cutter; signer ≠ cutter and ≠ reviewer.
      const priorActors =
        step === "review"
          ? [cur.cut_by]
          : [cur.cut_by, cur.reviewed_by];
      if (!enforceSeparationOfDuties(actor.id, priorActors.filter((x): x is string => Boolean(x)))) {
        throw new Error(
          `Separation of duties: the ${step}er cannot also be the ${step === "review" ? "cutter" : "cutter or reviewer"}`,
        );
      }
      if (step === "sign" && cur.state !== "reviewed") {
        throw new Error(`Cannot sign a check in state '${cur.state}' (must be 'reviewed')`);
      }

      const to = nextState(cur.state, action); // throws on illegal transition

      // Two distinct UPDATE shapes (approve sets actor/timestamp; reject sets reason).
      if (decision === "approve") {
        await client.query(
          `UPDATE ap_checks SET state = $1::ap_check_state, ${step === "review" ? "reviewed_by = $2, reviewed_at = NOW()" : "signed_by = $2, signed_at = NOW()"} WHERE id = $3`,
          [to, actor.id, checkId],
        );
      } else {
        await client.query(
          `UPDATE ap_checks SET state = 'rejected', reject_reason = $1 WHERE id = $2`,
          [notes ?? "(no reason given)", checkId],
        );
        // Rejected → the invoice returns to the cutter, re-cuttable.
        await client.query(
          `UPDATE ap_invoices SET status = 'entered', updated_at = NOW() WHERE id = $1`,
          [cur.invoice_id],
        );
      }

      await client.query(
        `INSERT INTO ap_approvals (check_id, step, actor_id, decision, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [checkId, step, actor.id, decision, notes ?? null],
      );

      return this.loadCheck(client, checkId);
    });

    const kind = decision === "reject" ? "AP_CHECK_REJECTED" : step === "review" ? "AP_CHECK_REVIEWED" : "AP_CHECK_SIGNED";
    const auditAction =
      decision === "reject" ? "ap_check_rejected" : step === "review" ? "ap_check_reviewed" : "ap_check_signed";
    await this.stampAndAudit(kind, auditAction, check, actor, {
      decision,
      ...(step === "sign" && decision === "approve" ? { wetSignatureAttested: true } : {}),
    });
    return this.rowToCheck(check);
  }

  // -------------------------------------------------------------------------
  // Disburse (calls the injected sink), void, reissue
  // -------------------------------------------------------------------------
  async disburseCheck(checkId: string, actor: { id: string; role: string }): Promise<ApCheckRecord> {
    const check = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ap:check:${checkId}`]);
      const cur = await this.loadCheck(client, checkId);
      nextState(cur.state, "disburse"); // validates state === 'signed'

      const result = await this.sink.disburse({
        checkId: cur.id,
        propertyId: cur.property_id as string,
        amountCents: Number(cur.amount_cents),
        checkNumber: cur.check_number,
        memo: {
          invoiceNumber: cur.invoice_number ?? null,
          billingNumber: cur.billing_number ?? null,
          unitNumber: cur.unit_number ?? null,
        },
      });

      await client.query(
        `UPDATE ap_checks SET state = 'disbursed', disbursed_at = NOW(), disbursement_ref = $1 WHERE id = $2`,
        [result.ref, checkId],
      );
      await client.query(`UPDATE ap_invoices SET status = 'disbursed', updated_at = NOW() WHERE id = $1`, [
        cur.invoice_id,
      ]);
      return this.loadCheck(client, checkId);
    });

    await this.stampAndAudit("AP_CHECK_DISBURSED", "ap_check_disbursed", check, actor, {
      disbursementRef: check.disbursement_ref,
    });
    return this.rowToCheck(check);
  }

  async voidCheck(
    checkId: string,
    reason: string,
    actor: { id: string; role: string },
  ): Promise<ApCheckRecord> {
    const check = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ap:check:${checkId}`]);
      const cur = await this.loadCheck(client, checkId);
      nextState(cur.state, "void"); // validates the check is in a voidable state
      await client.query(
        `UPDATE ap_checks SET state = 'voided', voided_by = $1, voided_at = NOW(), void_reason = $2 WHERE id = $3`,
        [actor.id, reason, checkId],
      );
      await client.query(`UPDATE ap_invoices SET status = 'entered', updated_at = NOW() WHERE id = $1`, [
        cur.invoice_id,
      ]);
      return this.loadCheck(client, checkId);
    });

    await this.stampAndAudit("AP_CHECK_VOIDED", "ap_check_voided", check, actor, { reason });
    return this.rowToCheck(check);
  }

  /** Reissue after a void: mint a NEW check that references the voided one (append-only). */
  async reissueCheck(checkId: string, actor: { id: string; role: string }): Promise<ApCheckRecord> {
    const fresh = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`ap:check:${checkId}`]);
      const cur = await this.loadCheck(client, checkId);
      if (cur.state !== "voided") throw new Error("Only a voided check can be reissued");
      const ins = await client.query(
        `INSERT INTO ap_checks (check_run_id, invoice_id, amount_cents, state, cut_by, reissued_from_check_id)
         VALUES ($1, $2, $3, 'cut', $4, $5) RETURNING *`,
        [cur.check_run_id, cur.invoice_id, cur.amount_cents, actor.id, cur.id],
      );
      await client.query(`UPDATE ap_invoices SET status = 'cut', updated_at = NOW() WHERE id = $1`, [
        cur.invoice_id,
      ]);
      return { ...ins.rows[0], property_id: cur.property_id };
    });

    await this.stampAndAudit("AP_CHECK_REISSUED", "ap_check_reissued", fresh, actor, {
      reissuedFromCheckId: checkId,
    });
    return this.rowToCheck(fresh);
  }

  async getCheck(checkId: string): Promise<ApCheckRecord | null> {
    const result = await query(
      `SELECT c.*, i.property_id, i.invoice_number, i.billing_number, i.unit_number
       FROM ap_checks c JOIN ap_invoices i ON i.id = c.invoice_id WHERE c.id = $1`,
      [checkId],
    );
    return result.rows.length ? this.rowToCheck(result.rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  /** Load a check joined to its invoice (property + memo triad) for a transition. */
  private async loadCheck(client: PoolClient, checkId: string): Promise<CheckRow> {
    const r = await client.query(
      `SELECT c.*, i.property_id, i.invoice_number, i.billing_number, i.unit_number
       FROM ap_checks c JOIN ap_invoices i ON i.id = c.invoice_id WHERE c.id = $1`,
      [checkId],
    );
    if (r.rows.length === 0) throw new Error("Check not found");
    return r.rows[0] as CheckRow;
  }

  private async stampAndAudit(
    kind: Parameters<typeof stampV2Ap>[0],
    auditAction: string,
    check: CheckRow,
    actor: { id: string; role: string },
    evidence: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog({
      action: auditAction,
      actorId: actor.id,
      actorRole: actor.role,
      resourceType: "ap_checks",
      resourceId: check.id,
      details: { state: check.state, ...evidence },
    });
    await stampV2Ap(kind, (check.property_id as string) ?? null, {
      actorId: actor.id,
      subjectId: check.id,
      evidence: { state: check.state, amountCents: Number(check.amount_cents), ...evidence },
    });
  }

  private rowToVendor(row: Record<string, unknown>): ApVendorRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      isActive: Boolean(row.is_active),
      createdAt: iso(row.created_at as Date) as string,
    };
  }

  private rowToInvoice(row: Record<string, unknown>): ApInvoiceRecord {
    return {
      id: row.id as string,
      vendorId: row.vendor_id as string,
      propertyId: row.property_id as string,
      unitId: (row.unit_id as string | null) ?? null,
      amountCents: Number(row.amount_cents),
      invoiceNumber: (row.invoice_number as string | null) ?? null,
      billingNumber: (row.billing_number as string | null) ?? null,
      unitNumber: (row.unit_number as string | null) ?? null,
      dueDate: iso((row.due_date as Date | null) ?? null),
      receivedVia: row.received_via as string,
      status: row.status as string,
      createdAt: iso(row.created_at as Date) as string,
    };
  }

  private rowToCheck(row: CheckRow): ApCheckRecord {
    return {
      id: row.id,
      checkRunId: row.check_run_id,
      invoiceId: row.invoice_id,
      amountCents: Number(row.amount_cents),
      checkNumber: row.check_number,
      state: row.state,
      cutBy: row.cut_by,
      reviewedBy: row.reviewed_by,
      signedBy: row.signed_by,
      voidedBy: row.voided_by,
      reissuedFromCheckId: row.reissued_from_check_id,
      disbursementRef: row.disbursement_ref,
      createdAt: iso(row.created_at) as string,
    };
  }
}
