/**
 * Tiny in-memory stand-in for config/database used ONLY by service.test.ts.
 *
 * It is NOT a general SQL engine — it recognizes exactly the statements
 * GlApService issues (matched by stable substrings) and maintains plain-array
 * tables with the few behaviors the service relies on: inserts with RETURNING
 * id, the idempotency SELECTs, the ON CONFLICT DO NOTHING / DO UPDATE upserts,
 * period-lock reads, and the balance/entry reads. This lets the service's
 * orchestration be tested without a live Postgres. If the service's SQL changes
 * shape, update the matchers here.
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

interface QueryResult {
  rows: Row[];
  rowCount: number;
}

export interface InMemoryDb {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  transaction<T>(fn: (client: { query: InMemoryDb["query"] }) => Promise<T>): Promise<T>;
  getClient(): Promise<{ query: InMemoryDb["query"]; release: () => void }>;
  reset(): void;
  table(name: string): Row[];
  seedAccounts(bookId: string, accts: Row[]): void;
  lockPeriod(bookId: string, period: string): void;
}

const has = (t: string, ...needles: string[]) => needles.every((n) => t.includes(n));

export function mkInMemoryDb(): InMemoryDb {
  let tables: Tables = blank();

  function blank(): Tables {
    return {
      gl_chart_of_accounts: [],
      gl_periods: [],
      gl_journal_entries: [],
      gl_journal_lines: [],
      gl_account_balances: [],
      ap_bills: [],
      ap_payments: [],
      gl_parallel_run_reports: [],
    };
  }

  async function query(text: string, params: unknown[] = []): Promise<QueryResult> {
    const t = text.replace(/\s+/g, " ").trim();

    // ── Chart of accounts ──────────────────────────────────────────────────
    if (has(t, "FROM gl_chart_of_accounts", "WHERE book_id = $1")) {
      const rows = tables.gl_chart_of_accounts.filter((r) => r.book_id === params[0]);
      return ok(rows);
    }

    // ── Period status reads ────────────────────────────────────────────────
    if (has(t, "SELECT status FROM gl_periods", "book_id = $1 AND period = $2")) {
      const row = tables.gl_periods.find((r) => r.book_id === params[0] && r.period === params[1]);
      return ok(row ? [{ status: row.status }] : []);
    }

    // ── Journal-entry idempotency lookup ───────────────────────────────────
    if (has(t, "SELECT id FROM gl_journal_entries", "mode = 'live'", "source_type = $2", "source_ref = $3")) {
      const row = tables.gl_journal_entries.find(
        (r) => r.book_id === params[0] && r.mode === "live" && r.source_type === params[1] && r.source_ref === params[2]
      );
      return ok(row ? [{ id: row.id }] : []);
    }

    // ── Insert journal entry (postJournalEntry path) ───────────────────────
    if (has(t, "INSERT INTO gl_journal_entries", "RETURNING id") && !t.includes("ON CONFLICT")) {
      const id = randomUUID();
      tables.gl_journal_entries.push({
        id,
        book_id: params[0],
        entry_date: new Date(params[1] as string),
        period: params[2],
        status: params[3],
        mode: params[4],
        memo: params[5],
        source_type: params[6],
        source_ref: params[7],
        posting_rule_id: params[8],
      });
      return ok([{ id }]);
    }

    // ── Insert journal entry with ON CONFLICT DO NOTHING (postFromRule) ─────
    if (has(t, "INSERT INTO gl_journal_entries", "ON CONFLICT", "DO NOTHING")) {
      const [book, date, period, mode, memo, sourceType, sourceRef, ruleId] = params;
      const conflict =
        mode === "live" &&
        sourceType != null &&
        sourceRef != null &&
        tables.gl_journal_entries.some(
          (r) => r.book_id === book && r.mode === "live" && r.source_type === sourceType && r.source_ref === sourceRef
        );
      if (conflict) return ok([]); // DO NOTHING → no RETURNING row
      const id = randomUUID();
      tables.gl_journal_entries.push({
        id,
        book_id: book,
        entry_date: new Date(date as string),
        period,
        status: "posted",
        mode,
        memo,
        source_type: sourceType,
        source_ref: sourceRef,
        posting_rule_id: ruleId,
      });
      return ok([{ id }]);
    }

    // ── Read a single entry header ─────────────────────────────────────────
    if (has(t, "FROM gl_journal_entries WHERE id = $1")) {
      const row = tables.gl_journal_entries.find((r) => r.id === params[0]);
      return ok(row ? [row] : []);
    }

    // ── Read entry ids for a book (loadEntries) ────────────────────────────
    if (has(t, "SELECT id FROM gl_journal_entries WHERE book_id = $1", "status = 'posted'")) {
      let rows = tables.gl_journal_entries.filter((r) => r.book_id === params[0] && r.status === "posted");
      if (t.includes("mode = 'live'")) rows = rows.filter((r) => r.mode === "live");
      if (t.includes("AND period = $2")) rows = rows.filter((r) => r.period === params[1]);
      return ok(rows.map((r) => ({ id: r.id })));
    }

    // ── Insert journal lines ───────────────────────────────────────────────
    if (has(t, "INSERT INTO gl_journal_lines")) {
      tables.gl_journal_lines.push({
        id: randomUUID(),
        entry_id: params[0],
        line_no: params[1],
        account_code: params[2],
        debit: params[3],
        credit: params[4],
        memo: params[5],
      });
      return ok([]);
    }

    // ── Read journal lines for an entry ────────────────────────────────────
    if (has(t, "FROM gl_journal_lines WHERE entry_id = $1")) {
      const rows = tables.gl_journal_lines
        .filter((r) => r.entry_id === params[0])
        .sort((a, b) => (a.line_no as number) - (b.line_no as number));
      return ok(rows);
    }

    // ── Account-balance upsert ─────────────────────────────────────────────
    if (has(t, "INSERT INTO gl_account_balances", "ON CONFLICT")) {
      const [book, code, period, debit, credit, net] = params;
      const existing = tables.gl_account_balances.find(
        (r) => r.book_id === book && r.account_code === code && r.period === period
      );
      if (existing) {
        existing.debit_total = debit;
        existing.credit_total = credit;
        existing.net_balance = net;
      } else {
        tables.gl_account_balances.push({
          book_id: book,
          account_code: code,
          period,
          debit_total: debit,
          credit_total: credit,
          net_balance: net,
        });
      }
      return ok([]);
    }

    // ── Period close upsert ────────────────────────────────────────────────
    if (has(t, "INSERT INTO gl_periods", "ON CONFLICT")) {
      const [book, period, lockedBy, tieOut] = params;
      const existing = tables.gl_periods.find((r) => r.book_id === book && r.period === period);
      if (existing) {
        existing.status = "locked";
        existing.locked_by = lockedBy;
        existing.tie_out = tieOut;
      } else {
        tables.gl_periods.push({ book_id: book, period, status: "locked", locked_by: lockedBy, tie_out: tieOut });
      }
      return ok([]);
    }

    // ── AP bills ───────────────────────────────────────────────────────────
    if (has(t, "SELECT id FROM ap_bills WHERE book_id = $1 AND source_ref = $2")) {
      const row = tables.ap_bills.find((r) => r.book_id === params[0] && r.source_ref === params[1]);
      return ok(row ? [{ id: row.id }] : []);
    }
    if (has(t, "INSERT INTO ap_bills", "RETURNING id")) {
      const id = randomUUID();
      tables.ap_bills.push({
        id,
        book_id: params[0],
        vendor_id: params[1],
        bill_number: params[2],
        status: "draft",
        bill_date: params[3] ? new Date(params[3] as string) : null,
        due_date: params[4] ? new Date(params[4] as string) : null,
        amount: params[5],
        amount_paid: 0,
        source_doc_type: params[6],
        memo: params[7],
        source_ref: params[8],
      });
      return ok([{ id }]);
    }
    if (has(t, "FROM ap_bills WHERE id = $1")) {
      const row = tables.ap_bills.find((r) => r.id === params[0]);
      return ok(row ? [row] : []);
    }
    if (has(t, "UPDATE ap_bills SET", "status = $2")) {
      const row = tables.ap_bills.find((r) => r.id === params[0]);
      if (row) {
        row.status = params[1];
        if (t.includes("approved_at = NOW()")) row.approved_at = new Date();
      }
      return ok([]);
    }
    if (has(t, "UPDATE ap_bills SET amount_paid = $2, status = $3")) {
      const row = tables.ap_bills.find((r) => r.id === params[0]);
      if (row) {
        row.amount_paid = params[1];
        row.status = params[2];
      }
      return ok([]);
    }

    // ── AP payments ────────────────────────────────────────────────────────
    if (has(t, "SELECT id FROM ap_payments WHERE book_id = $1 AND source_ref = $2")) {
      const row = tables.ap_payments.find((r) => r.book_id === params[0] && r.source_ref === params[1]);
      return ok(row ? [{ id: row.id }] : []);
    }
    if (has(t, "INSERT INTO ap_payments")) {
      tables.ap_payments.push({
        id: randomUUID(),
        bill_id: params[0],
        book_id: params[1],
        amount: params[2],
        payment_date: params[3],
        method: params[4],
        reference: params[5],
        source_ref: params[6],
      });
      return ok([]);
    }

    // ── Parallel-run report ────────────────────────────────────────────────
    if (has(t, "INSERT INTO gl_parallel_run_reports")) {
      tables.gl_parallel_run_reports.push({
        id: randomUUID(),
        book_id: params[0],
        period: params[1],
        matched: params[2],
        variance_count: params[3],
        report: params[4],
      });
      return ok([]);
    }

    throw new Error(`in-memory-db: unrecognized SQL: ${t.slice(0, 120)}`);
  }

  function ok(rows: Row[]): QueryResult {
    return { rows, rowCount: rows.length };
  }

  async function transaction<T>(fn: (client: { query: InMemoryDb["query"] }) => Promise<T>): Promise<T> {
    // No real rollback; the service's pure validation happens before any write,
    // so a thrown error leaves at most a header without lines — acceptable for
    // these orchestration assertions (and the real DB trigger enforces balance).
    return fn({ query });
  }

  async function getClient() {
    return { query, release: () => undefined };
  }

  return {
    query,
    transaction,
    getClient,
    reset() {
      tables = blank();
    },
    table(name: string) {
      return tables[name] ?? [];
    },
    seedAccounts(bookId: string, accts: Row[]) {
      for (const a of accts) {
        tables.gl_chart_of_accounts.push({
          book_id: bookId,
          code: a.code,
          name: a.name,
          account_type: a.account_type,
          normal_side: a.normal_side,
          parent_code: null,
          is_active: true,
          is_placeholder: true,
        });
      }
    },
    lockPeriod(bookId: string, period: string) {
      tables.gl_periods.push({ book_id: bookId, period, status: "locked" });
    },
  };
}
