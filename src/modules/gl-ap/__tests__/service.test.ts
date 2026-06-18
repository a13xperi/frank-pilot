/**
 * B3 — GlApService orchestration tests.
 *
 * The service binds the pure engine to Postgres. Rather than stand up a real
 * database, this suite installs a small IN-MEMORY fake of config/database
 * (`query` + `transaction`) that understands the handful of statements the
 * service issues. That keeps the ORCHESTRATION genuinely under test — AP state
 * transitions, posting-on-approve via the config rule, idempotency, locked-
 * period refusal, and shadow reconciliation — independent of a live DB. The
 * pure laws themselves are covered exhaustively in the sibling suites.
 *
 * Follows the repo convention of `jest.mock("../../config/database", …)`.
 */

import { mkInMemoryDb } from "../test-support/in-memory-db";

const db = mkInMemoryDb();

jest.mock("../../../config/database", () => ({
  query: (text: string, params?: unknown[]) => db.query(text, params),
  transaction: <T>(fn: (client: { query: typeof db.query }) => Promise<T>) => db.transaction(fn),
  getClient: () => db.getClient(),
  pool: {},
}));
jest.mock("../../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { GlApService, PeriodLockedError } from "../service";
import { loadPostingRules } from "../posting-rules";
import { UnbalancedEntryError } from "../posting";

const BOOK = "book-1";

beforeEach(() => {
  db.reset();
  // Seed a minimal chart of accounts for the book.
  db.seedAccounts(BOOK, [
    { code: "1000", name: "Cash", account_type: "asset", normal_side: "debit" },
    { code: "2000", name: "AP", account_type: "liability", normal_side: "credit" },
    { code: "5000", name: "R&M", account_type: "expense", normal_side: "debit" },
    { code: "5100", name: "Utilities", account_type: "expense", normal_side: "debit" },
    { code: "4000", name: "Rent", account_type: "revenue", normal_side: "credit" },
  ]);
});

function svc(): GlApService {
  return new GlApService(loadPostingRules());
}

describe("GlApService.postJournalEntry", () => {
  it("persists a balanced entry with its lines", async () => {
    const e = await svc().postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-18",
      lines: [
        { accountCode: "5000", debit: 100 },
        { accountCode: "2000", credit: 100 },
      ],
    });
    expect(e.id).toBeTruthy();
    expect(db.table("gl_journal_entries")).toHaveLength(1);
    expect(db.table("gl_journal_lines")).toHaveLength(2);
  });

  it("REJECTS an unbalanced entry before any write", async () => {
    await expect(
      svc().postJournalEntry({
        bookId: BOOK,
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000", debit: 100 },
          { accountCode: "2000", credit: 90 },
        ],
      })
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
    expect(db.table("gl_journal_entries")).toHaveLength(0); // nothing written
  });

  it("is idempotent on (book, source_type, source_ref) for live entries", async () => {
    const input = {
      bookId: BOOK,
      entryDate: "2026-06-18",
      sourceType: "manual",
      sourceRef: "X-1",
      lines: [
        { accountCode: "5000", debit: 50 },
        { accountCode: "2000", credit: 50 },
      ],
    };
    const a = await svc().postJournalEntry(input);
    const b = await svc().postJournalEntry(input);
    expect(a.id).toBe(b.id);
    expect(db.table("gl_journal_entries")).toHaveLength(1);
  });

  it("refuses to post into a locked period", async () => {
    db.lockPeriod(BOOK, "2026-06");
    await expect(
      svc().postJournalEntry({
        bookId: BOOK,
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000", debit: 10 },
          { accountCode: "2000", credit: 10 },
        ],
      })
    ).rejects.toBeInstanceOf(PeriodLockedError);
  });

  it("allows shadow entries even into a locked period (never system-of-record)", async () => {
    db.lockPeriod(BOOK, "2026-06");
    const e = await svc().postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-18",
      mode: "shadow",
      lines: [
        { accountCode: "5000", debit: 10 },
        { accountCode: "2000", credit: 10 },
      ],
    });
    expect(e.mode).toBe("shadow");
  });
});

describe("GlApService AP workflow (intake → approve → pay → GL posting)", () => {
  it("intake creates a draft bill (idempotent on source_ref)", async () => {
    const s = svc();
    const bill = await s.intakeBill({
      bookId: BOOK,
      amount: 200,
      sourceDocType: "vendor_invoice",
      sourceRef: "INV-100",
      billDate: "2026-06-18",
    });
    expect(bill.status).toBe("draft");
    const again = await s.intakeBill({
      bookId: BOOK,
      amount: 200,
      sourceDocType: "vendor_invoice",
      sourceRef: "INV-100",
      billDate: "2026-06-18",
    });
    expect(again.id).toBe(bill.id);
    expect(db.table("ap_bills")).toHaveLength(1);
  });

  it("approval posts the accrual (Dr expense / Cr AP) via the config rule", async () => {
    const s = svc();
    const bill = await s.intakeBill({
      bookId: BOOK,
      amount: 200,
      sourceDocType: "vendor_invoice",
      sourceRef: "INV-200",
      billDate: "2026-06-18",
    });
    await s.transitionBill(bill.id!, "submit");
    const approved = await s.transitionBill(bill.id!, "approve");
    expect(approved.status).toBe("approved");
    // An accrual journal entry now exists for this bill.
    const entries = db.table("gl_journal_entries");
    const accrual = entries.find((e) => e.source_ref === `bill:${bill.id}:accrual`);
    expect(accrual).toBeTruthy();
    const lines = db.table("gl_journal_lines").filter((l) => l.entry_id === accrual!.id);
    expect(lines).toHaveLength(2);
    // The pair must balance.
    const dr = lines.reduce((a, l) => a + Number(l.debit), 0);
    const cr = lines.reduce((a, l) => a + Number(l.credit), 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(200);
  });

  it("recording a partial then final payment drives status and posts disbursements", async () => {
    const s = svc();
    const bill = await s.intakeBill({
      bookId: BOOK,
      amount: 100,
      sourceDocType: "vendor_invoice",
      sourceRef: "INV-300",
      billDate: "2026-06-18",
    });
    await s.transitionBill(bill.id!, "submit");
    await s.transitionBill(bill.id!, "approve");

    const p1 = await s.recordPayment(bill.id!, { amount: 40, paymentDate: "2026-06-18", sourceRef: "PAY-1" });
    expect(p1.bill.status).toBe("partially_paid");
    expect(p1.bill.amountPaid).toBe(40);
    expect(p1.entry).toBeTruthy();

    const p2 = await s.recordPayment(bill.id!, { amount: 60, paymentDate: "2026-06-18", sourceRef: "PAY-2" });
    expect(p2.bill.status).toBe("paid");
    expect(p2.bill.amountPaid).toBe(100);

    // Two payment rows, two disbursement entries.
    expect(db.table("ap_payments")).toHaveLength(2);
  });

  it("rejects an illegal transition (paying a draft)", async () => {
    const s = svc();
    const bill = await s.intakeBill({
      bookId: BOOK,
      amount: 100,
      sourceDocType: "vendor_invoice",
      sourceRef: "INV-400",
      billDate: "2026-06-18",
    });
    await expect(
      s.recordPayment(bill.id!, { amount: 10, sourceRef: "PAY-X" })
    ).rejects.toThrow(/Illegal AP bill transition/);
  });

  it("payment is idempotent on source_ref", async () => {
    const s = svc();
    const bill = await s.intakeBill({
      bookId: BOOK,
      amount: 100,
      sourceDocType: "vendor_invoice",
      sourceRef: "INV-500",
      billDate: "2026-06-18",
    });
    await s.transitionBill(bill.id!, "submit");
    await s.transitionBill(bill.id!, "approve");
    await s.recordPayment(bill.id!, { amount: 50, sourceRef: "PAY-DUP" });
    const dup = await s.recordPayment(bill.id!, { amount: 50, sourceRef: "PAY-DUP" });
    expect(dup.entry).toBeNull(); // skipped
    expect(db.table("ap_payments")).toHaveLength(1);
  });
});

describe("GlApService.periodClose + deriveBalances", () => {
  it("derives balances from posted live entries", async () => {
    const s = svc();
    await s.postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-01",
      lines: [
        { accountCode: "5000", debit: 100 },
        { accountCode: "2000", credit: 100 },
      ],
    });
    const balances = await s.deriveBalances(BOOK, "2026-06");
    const exp = balances.find((b) => b.accountCode === "5000")!;
    expect(exp.netBalance).toBe(100);
    expect(db.table("gl_account_balances").length).toBeGreaterThan(0);
  });

  it("closes a balanced period, locking it; further live posts are refused", async () => {
    const s = svc();
    await s.postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-05",
      lines: [
        { accountCode: "5000", debit: 75 },
        { accountCode: "2000", credit: 75 },
      ],
    });
    const tie = await s.periodClose(BOOK, "2026-06");
    expect(tie.balanced).toBe(true);
    expect(tie.debitTotal).toBe(75);
    await expect(
      s.postJournalEntry({
        bookId: BOOK,
        entryDate: "2026-06-06",
        lines: [
          { accountCode: "5000", debit: 1 },
          { accountCode: "2000", credit: 1 },
        ],
      })
    ).rejects.toBeInstanceOf(PeriodLockedError);
  });
});

describe("GlApService.reconcileShadow (parallel run)", () => {
  it("matches when shadow postings equal the source figures", async () => {
    const s = svc();
    await s.postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-10",
      mode: "shadow",
      lines: [
        { accountCode: "5000", debit: 300 },
        { accountCode: "2000", credit: 300 },
      ],
    });
    const report = await s.reconcileShadow(BOOK, "2026-06", [
      { accountCode: "5000", netBalance: 300 },
      { accountCode: "2000", netBalance: 300 },
    ]);
    expect(report.matched).toBe(true);
    expect(db.table("gl_parallel_run_reports")).toHaveLength(1);
  });

  it("reports variances when shadow diverges from source", async () => {
    const s = svc();
    await s.postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-10",
      mode: "shadow",
      lines: [
        { accountCode: "5000", debit: 300 },
        { accountCode: "2000", credit: 300 },
      ],
    });
    const report = await s.reconcileShadow(BOOK, "2026-06", [
      { accountCode: "5000", netBalance: 250 }, // off by 50
      { accountCode: "2000", netBalance: 300 },
    ]);
    expect(report.matched).toBe(false);
    expect(report.variances.some((v) => v.accountCode === "5000")).toBe(true);
  });

  it("shadow entries do NOT count toward live balances", async () => {
    const s = svc();
    await s.postJournalEntry({
      bookId: BOOK,
      entryDate: "2026-06-10",
      mode: "shadow",
      lines: [
        { accountCode: "5000", debit: 999 },
        { accountCode: "2000", credit: 999 },
      ],
    });
    const live = await s.deriveBalances(BOOK, "2026-06");
    expect(live.find((b) => b.accountCode === "5000")).toBeUndefined(); // no live posting
  });
});
