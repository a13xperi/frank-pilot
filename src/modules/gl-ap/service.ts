/**
 * B3 — Entity-level GL/AP service: DB-backed orchestration over the pure engine.
 *
 * The pure modules (posting.ts, ap-state-machine.ts, posting-rules.ts,
 * reconciliation.ts) hold all the LAWS; this service is the thin layer that
 * persists what they validate, inside transactions, against the gl_/ap_ tables
 * (migration 2026-06-18-gl-ap-foundation.sql). It reuses the repo's
 * config/database `query`/`transaction` helpers and migration conventions.
 *
 * Guarantees:
 *   - postJournalEntry rejects unbalanced entries BEFORE any write (the pure
 *     choke-point), and the DB constraint trigger is a second backstop.
 *   - postings into a LOCKED period are refused.
 *   - shadow-mode entries are persisted but never counted toward live balances.
 *   - source_ref makes intake/posting idempotent (partial unique indexes).
 *
 * Nothing here hardcodes an entity-specific account or rule. The rule set + COA
 * are loaded from config (loadPostingRules / loadChartOfAccounts), i.e. Tanya's
 * intake slots in as DATA.
 */

import { query, transaction } from "../../config/database";
import { logger } from "../../utils/logger";
import {
  AccountBalance,
  Account,
  ApBill,
  ApBillStatus,
  EntryMode,
  JournalEntry,
  JournalEntryInput,
  ReconciliationReport,
  SourceBalance,
  TieOut,
} from "./types";
import {
  buildJournalEntry,
  computeTieOut,
  deriveBalances,
  netInNormalDirection,
  periodClose as pureClose,
  periodOf,
  postJournalEntry as purePost,
} from "./posting";
import {
  ApBillAction,
  nextState,
  postingMomentFor,
  settlePaymentState,
} from "./ap-state-machine";
import {
  applyPostingRule,
  loadPostingRules,
  PostingRuleError,
  SourceDocument,
} from "./posting-rules";
import { reconcile } from "./reconciliation";
import { PostingRuleSet } from "./types";

export class PeriodLockedError extends Error {
  constructor(period: string) {
    super(`Period ${period} is locked; postings into a closed period are not allowed`);
    this.name = "PeriodLockedError";
  }
}

export class GlApService {
  /** Lazily-loaded rule set (config-driven). Override via setRuleSet for tests/live. */
  private ruleSet: PostingRuleSet;

  constructor(ruleSet?: PostingRuleSet) {
    this.ruleSet = ruleSet ?? loadPostingRules();
  }

  setRuleSet(ruleSet: PostingRuleSet): void {
    this.ruleSet = ruleSet;
  }

  getRuleSet(): PostingRuleSet {
    return this.ruleSet;
  }

  // ── Chart of accounts ──────────────────────────────────────────────────────

  async listAccounts(bookId: string): Promise<Account[]> {
    const r = await query(
      `SELECT code, name, account_type, normal_side, parent_code, is_active, is_placeholder
         FROM gl_chart_of_accounts WHERE book_id = $1 ORDER BY code`,
      [bookId]
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      code: row.code as string,
      name: row.name as string,
      accountType: row.account_type as Account["accountType"],
      normalSide: row.normal_side as Account["normalSide"],
      parentCode: (row.parent_code as string) ?? null,
      isActive: row.is_active as boolean,
      isPlaceholder: row.is_placeholder as boolean,
    }));
  }

  // ── Period state ───────────────────────────────────────────────────────────

  async isPeriodLocked(bookId: string, period: string): Promise<boolean> {
    const r = await query(
      `SELECT status FROM gl_periods WHERE book_id = $1 AND period = $2`,
      [bookId, period]
    );
    return r.rows[0]?.status === "locked";
  }

  // ── Posting ────────────────────────────────────────────────────────────────

  /**
   * Validate (pure) → reject if the period is locked → persist header + lines in
   * one transaction. The DB constraint trigger re-checks the balance at COMMIT.
   * Idempotent on (book_id, source_type, source_ref) for live entries: a repeat
   * returns the existing entry instead of double-posting.
   */
  async postJournalEntry(input: JournalEntryInput): Promise<JournalEntry> {
    // 1) Pure validation — throws UnbalancedEntryError on imbalance.
    const entry = purePost(input);

    // 2) Locked-period guard (live entries only; shadow may post freely).
    if (entry.mode === "live" && (await this.isPeriodLocked(entry.bookId, entry.period))) {
      throw new PeriodLockedError(entry.period);
    }

    // 3) Idempotency: return existing live entry for the same source doc.
    if (entry.mode === "live" && entry.sourceType && entry.sourceRef) {
      const existing = await query(
        `SELECT id FROM gl_journal_entries
          WHERE book_id = $1 AND mode = 'live' AND source_type = $2 AND source_ref = $3`,
        [entry.bookId, entry.sourceType, entry.sourceRef]
      );
      if (existing.rows[0]) {
        const found = await this.getEntry(existing.rows[0].id as string);
        if (found) return found;
      }
    }

    // 4) Persist atomically.
    return transaction(async (client) => {
      const hdr = await client.query(
        `INSERT INTO gl_journal_entries
           (book_id, entry_date, period, status, mode, memo, source_type, source_ref, posting_rule_id, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $4='posted' THEN NOW() ELSE NULL END)
         RETURNING id`,
        [
          entry.bookId,
          entry.entryDate,
          entry.period,
          entry.status,
          entry.mode,
          entry.memo,
          entry.sourceType,
          entry.sourceRef,
          entry.postingRuleId,
        ]
      );
      const entryId = hdr.rows[0].id as string;
      for (const line of entry.lines) {
        await client.query(
          `INSERT INTO gl_journal_lines (entry_id, line_no, account_code, debit, credit, memo)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [entryId, line.lineNo, line.accountCode, line.debit, line.credit, line.memo ?? null]
        );
      }
      logger.info("gl-ap: posted journal entry", {
        entryId,
        bookId: entry.bookId,
        period: entry.period,
        mode: entry.mode,
      });
      return { ...entry, id: entryId };
    });
  }

  async getEntry(id: string): Promise<JournalEntry | null> {
    const h = await query(
      `SELECT id, book_id, entry_date, period, status, mode, memo, source_type, source_ref, posting_rule_id
         FROM gl_journal_entries WHERE id = $1`,
      [id]
    );
    if (!h.rows[0]) return null;
    const row = h.rows[0] as Record<string, unknown>;
    const l = await query(
      `SELECT line_no, account_code, debit, credit, memo
         FROM gl_journal_lines WHERE entry_id = $1 ORDER BY line_no`,
      [id]
    );
    return {
      id: row.id as string,
      bookId: row.book_id as string,
      entryDate: (row.entry_date as Date).toISOString().split("T")[0],
      period: row.period as string,
      status: row.status as JournalEntry["status"],
      mode: row.mode as EntryMode,
      memo: (row.memo as string) ?? null,
      sourceType: (row.source_type as string) ?? null,
      sourceRef: (row.source_ref as string) ?? null,
      postingRuleId: (row.posting_rule_id as string) ?? null,
      lines: l.rows.map((lr: Record<string, unknown>) => ({
        lineNo: lr.line_no as number,
        accountCode: lr.account_code as string,
        debit: parseFloat(lr.debit as string),
        credit: parseFloat(lr.credit as string),
        memo: (lr.memo as string) ?? null,
      })),
    };
  }

  /** Load all posted entries for a book (optionally a period / including shadow). */
  private async loadEntries(
    bookId: string,
    opts: { period?: string; includeShadow?: boolean } = {}
  ): Promise<JournalEntry[]> {
    const params: unknown[] = [bookId];
    let sql = `SELECT id FROM gl_journal_entries WHERE book_id = $1 AND status = 'posted'`;
    if (!opts.includeShadow) sql += ` AND mode = 'live'`;
    if (opts.period) {
      params.push(opts.period);
      sql += ` AND period = $${params.length}`;
    }
    const ids = await query(sql, params);
    const out: JournalEntry[] = [];
    for (const r of ids.rows) {
      const e = await this.getEntry(r.id as string);
      if (e) out.push(e);
    }
    return out;
  }

  // ── Balances ───────────────────────────────────────────────────────────────

  /**
   * Recompute per-account balances for a book from posted LIVE entries and
   * persist the snapshot into gl_account_balances. Returns the derived rows.
   */
  async deriveBalances(bookId: string, period?: string): Promise<AccountBalance[]> {
    const accounts = await this.listAccounts(bookId);
    const entries = await this.loadEntries(bookId, { period });
    const balances = deriveBalances(entries, accounts, { period });

    await transaction(async (client) => {
      for (const b of balances) {
        await client.query(
          `INSERT INTO gl_account_balances (book_id, account_code, period, debit_total, credit_total, net_balance, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6, NOW())
           ON CONFLICT (book_id, account_code, period)
           DO UPDATE SET debit_total = EXCLUDED.debit_total,
                         credit_total = EXCLUDED.credit_total,
                         net_balance = EXCLUDED.net_balance,
                         computed_at = NOW()`,
          [bookId, b.accountCode, b.period, b.debitTotal, b.creditTotal, b.netBalance]
        );
      }
    });
    return balances;
  }

  // ── Period close ───────────────────────────────────────────────────────────

  /**
   * Close a period: compute the tie-out from posted live entries; if it
   * balances, lock the period and snapshot the tie-out. Refuses to lock an
   * unbalanced period (pureClose throws PeriodNotBalancedError).
   */
  async periodClose(bookId: string, period: string, lockedBy?: string): Promise<TieOut> {
    const accounts = await this.listAccounts(bookId);
    const entries = await this.loadEntries(bookId, { period });
    const tieOut = pureClose(entries, accounts, period); // throws if unbalanced

    await transaction(async (client) => {
      await client.query(
        `INSERT INTO gl_periods (book_id, period, status, locked_at, locked_by, tie_out)
         VALUES ($1,$2,'locked', NOW(), $3, $4)
         ON CONFLICT (book_id, period)
         DO UPDATE SET status='locked', locked_at=NOW(), locked_by=$3, tie_out=$4`,
        [bookId, period, lockedBy ?? null, JSON.stringify(tieOut)]
      );
    });
    logger.info("gl-ap: period closed", { bookId, period, balanced: tieOut.balanced });
    return tieOut;
  }

  // ── AP workflow ────────────────────────────────────────────────────────────

  /** Intake a vendor bill (idempotent on source_ref). Starts in 'draft'. */
  async intakeBill(bill: Omit<ApBill, "status" | "amountPaid"> & { status?: ApBillStatus }): Promise<ApBill> {
    if (bill.sourceRef) {
      const existing = await query(
        `SELECT id FROM ap_bills WHERE book_id = $1 AND source_ref = $2`,
        [bill.bookId, bill.sourceRef]
      );
      if (existing.rows[0]) {
        const found = await this.getBill(existing.rows[0].id as string);
        if (found) return found;
      }
    }
    const r = await query(
      `INSERT INTO ap_bills (book_id, vendor_id, bill_number, status, bill_date, due_date, amount, amount_paid, source_doc_type, memo, source_ref)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,0,$7,$8,$9) RETURNING id`,
      [
        bill.bookId,
        bill.vendorId ?? null,
        bill.billNumber ?? null,
        bill.billDate ?? null,
        bill.dueDate ?? null,
        bill.amount,
        bill.sourceDocType,
        bill.memo ?? null,
        bill.sourceRef ?? null,
      ]
    );
    const found = await this.getBill(r.rows[0].id as string);
    if (!found) throw new Error("intakeBill: insert returned no row");
    return found;
  }

  async getBill(id: string): Promise<ApBill | null> {
    const r = await query(
      `SELECT id, book_id, vendor_id, bill_number, status, bill_date, due_date, amount, amount_paid, source_doc_type, memo, source_ref
         FROM ap_bills WHERE id = $1`,
      [id]
    );
    if (!r.rows[0]) return null;
    const row = r.rows[0] as Record<string, unknown>;
    return {
      id: row.id as string,
      bookId: row.book_id as string,
      vendorId: (row.vendor_id as string) ?? null,
      billNumber: (row.bill_number as string) ?? null,
      status: row.status as ApBillStatus,
      amount: parseFloat(row.amount as string),
      amountPaid: parseFloat(row.amount_paid as string),
      sourceDocType: row.source_doc_type as string,
      billDate: row.bill_date ? (row.bill_date as Date).toISOString().split("T")[0] : null,
      dueDate: row.due_date ? (row.due_date as Date).toISOString().split("T")[0] : null,
      memo: (row.memo as string) ?? null,
      sourceRef: (row.source_ref as string) ?? null,
    };
  }

  /**
   * Drive a bill through its lifecycle (pure state machine resolves the next
   * state). On `approve`, posts the accrual (Dr expense / Cr AP) via the config
   * rule. Payments go through `recordPayment` (which carries an amount), not
   * this method. Returns the updated bill.
   */
  async transitionBill(billId: string, action: Exclude<ApBillAction, "record_payment">): Promise<ApBill> {
    const bill = await this.getBill(billId);
    if (!bill) throw new Error(`Bill ${billId} not found`);
    const to = nextState(bill.status, action); // throws on illegal transition

    return transaction(async (client) => {
      const patch: string[] = ["status = $2"];
      const params: unknown[] = [billId, to];
      if (action === "approve") {
        patch.push("approved_at = NOW()");
      }
      await client.query(
        `UPDATE ap_bills SET ${patch.join(", ")}, updated_at = NOW() WHERE id = $1`,
        params
      );

      // GL posting moment: approval accrues the payable.
      if (postingMomentFor(action) === "accrue_payable") {
        await this.postFromRule(
          {
            bookId: bill.bookId,
            sourceDocType: bill.sourceDocType,
            entryDate: bill.billDate ?? new Date().toISOString().split("T")[0],
            amount: bill.amount,
            sourceRef: `bill:${bill.id}:accrual`,
            memo: `AP accrual for bill ${bill.billNumber ?? bill.id}`,
          },
          client
        );
      }

      const updated = await this.getBill(billId);
      if (!updated) throw new Error("transitionBill: bill vanished mid-transaction");
      return updated;
    });
  }

  /**
   * Record a payment against a bill: validate the transition, persist the
   * payment, advance amount_paid, resolve paid/partially_paid by amount, and
   * post the disbursement (Dr AP / Cr cash) via the config rule. Idempotent on
   * the payment's source_ref.
   */
  async recordPayment(
    billId: string,
    payment: { amount: number; paymentDate?: string; method?: string; reference?: string; sourceRef?: string }
  ): Promise<{ bill: ApBill; entry: JournalEntry | null }> {
    const bill = await this.getBill(billId);
    if (!bill) throw new Error(`Bill ${billId} not found`);
    // Validate the lifecycle move (throws if illegal — e.g. paying a draft).
    nextState(bill.status, "record_payment");
    if (payment.amount <= 0) throw new Error("Payment amount must be positive");

    return transaction(async (client) => {
      // Idempotency: skip a duplicate payment by source_ref.
      if (payment.sourceRef) {
        const dup = await client.query(
          `SELECT id FROM ap_payments WHERE book_id = $1 AND source_ref = $2`,
          [bill.bookId, payment.sourceRef]
        );
        if (dup.rows[0]) {
          const existing = await this.getBill(billId);
          return { bill: existing!, entry: null };
        }
      }

      await client.query(
        `INSERT INTO ap_payments (bill_id, book_id, amount, payment_date, method, reference, source_doc_type, source_ref)
         VALUES ($1,$2,$3,$4,$5,$6,'vendor_payment',$7)`,
        [
          billId,
          bill.bookId,
          payment.amount,
          payment.paymentDate ?? null,
          payment.method ?? null,
          payment.reference ?? null,
          payment.sourceRef ?? null,
        ]
      );

      const newPaid = Math.round((bill.amountPaid + payment.amount) * 100) / 100;
      const newStatus = settlePaymentState(bill.amount, newPaid);
      await client.query(
        `UPDATE ap_bills SET amount_paid = $2, status = $3, updated_at = NOW() WHERE id = $1`,
        [billId, newPaid, newStatus]
      );

      // GL posting moment: disbursement.
      const entry = await this.postFromRule(
        {
          bookId: bill.bookId,
          sourceDocType: "vendor_payment",
          entryDate: payment.paymentDate ?? new Date().toISOString().split("T")[0],
          amount: payment.amount,
          sourceRef: payment.sourceRef ?? `payment:${billId}:${newPaid}`,
          memo: `AP payment for bill ${bill.billNumber ?? bill.id}`,
        },
        client
      );

      const updated = await this.getBill(billId);
      return { bill: updated!, entry };
    });
  }

  /**
   * Apply the config posting rule for a source doc and persist the entry on the
   * provided transaction client (so it shares the AP write's atomicity). Pure
   * rule application + balance check happen before any write.
   */
  private async postFromRule(
    doc: SourceDocument,
    client: import("pg").PoolClient
  ): Promise<JournalEntry> {
    const input = applyPostingRule(this.ruleSet, doc); // throws if no rule
    const entry = buildJournalEntry(input, "posted"); // throws if unbalanced

    if (entry.mode === "live") {
      const locked = await client.query(
        `SELECT status FROM gl_periods WHERE book_id = $1 AND period = $2`,
        [entry.bookId, entry.period]
      );
      if (locked.rows[0]?.status === "locked") throw new PeriodLockedError(entry.period);
    }

    const hdr = await client.query(
      `INSERT INTO gl_journal_entries
         (book_id, entry_date, period, status, mode, memo, source_type, source_ref, posting_rule_id, posted_at)
       VALUES ($1,$2,$3,'posted',$4,$5,$6,$7,$8, NOW())
       ON CONFLICT (book_id, source_type, source_ref) WHERE (mode = 'live' AND source_type IS NOT NULL AND source_ref IS NOT NULL)
       DO NOTHING
       RETURNING id`,
      [
        entry.bookId,
        entry.entryDate,
        entry.period,
        entry.mode,
        entry.memo,
        entry.sourceType,
        entry.sourceRef,
        entry.postingRuleId,
      ]
    );
    if (!hdr.rows[0]) {
      // Conflict → already posted; fetch it.
      const existing = await client.query(
        `SELECT id FROM gl_journal_entries WHERE book_id=$1 AND source_type=$2 AND source_ref=$3 AND mode='live'`,
        [entry.bookId, entry.sourceType, entry.sourceRef]
      );
      const found = existing.rows[0] ? await this.getEntry(existing.rows[0].id as string) : null;
      return found ?? { ...entry };
    }
    const entryId = hdr.rows[0].id as string;
    for (const line of entry.lines) {
      await client.query(
        `INSERT INTO gl_journal_lines (entry_id, line_no, account_code, debit, credit, memo)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [entryId, line.lineNo, line.accountCode, line.debit, line.credit, line.memo ?? null]
      );
    }
    return { ...entry, id: entryId };
  }

  // ── Parallel-run / shadow reconciliation ─────────────────────────────────────

  /**
   * Reconcile the SHADOW book's derived balances for a period against the
   * source-of-record figures supplied by the caller (export from the existing
   * system), persist the report, and return it. This is the parallel-run
   * scorecard — shadow entries are never system-of-record.
   */
  async reconcileShadow(
    bookId: string,
    period: string,
    sourceBalances: SourceBalance[]
  ): Promise<ReconciliationReport> {
    const accounts = await this.listAccounts(bookId);
    const shadowEntries = await this.loadEntries(bookId, { period, includeShadow: true });
    // Only the shadow-mode subset.
    const shadowOnly = shadowEntries.filter((e) => e.mode === "shadow");
    const shadowBalances = deriveBalances(shadowOnly, accounts, { period, includeShadow: true });
    const report = reconcile(bookId, period, shadowBalances, sourceBalances);

    await query(
      `INSERT INTO gl_parallel_run_reports (book_id, period, matched, variance_count, report)
       VALUES ($1,$2,$3,$4,$5)`,
      [bookId, period, report.matched, report.varianceCount, JSON.stringify(report)]
    );
    return report;
  }
}

// Convenience: a default instance using the placeholder config.
export const glApService = new GlApService();

export {
  // re-exports so callers import the surface from one module
  PostingRuleError,
  computeTieOut,
  netInNormalDirection,
  periodOf,
};
