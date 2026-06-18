import fc from "fast-check";
import { reconcile, summarizeReport, DEFAULT_TOLERANCE } from "../reconciliation";
import { buildJournalEntry, deriveBalances } from "../posting";
import { Account, AccountBalance, JournalEntry, SourceBalance } from "../types";

const COA: Pick<Account, "code" | "normalSide">[] = [
  { code: "1000", normalSide: "debit" },
  { code: "2000", normalSide: "credit" },
  { code: "5000", normalSide: "debit" },
];

describe("parallel-run reconciliation (shadow vs source)", () => {
  it("MATCHES when shadow equals source", () => {
    const shadow: AccountBalance[] = [
      { accountCode: "5000", period: "2026-06", debitTotal: 100, creditTotal: 0, netBalance: 100 },
      { accountCode: "2000", period: "2026-06", debitTotal: 0, creditTotal: 100, netBalance: 100 },
    ];
    const source: SourceBalance[] = [
      { accountCode: "5000", netBalance: 100 },
      { accountCode: "2000", netBalance: 100 },
    ];
    const r = reconcile("b1", "2026-06", shadow, source);
    expect(r.matched).toBe(true);
    expect(r.varianceCount).toBe(0);
    expect(summarizeReport(r)).toMatch(/MATCH/);
  });

  it("flags an amount_mismatch when a balance differs beyond tolerance", () => {
    const shadow: AccountBalance[] = [
      { accountCode: "5000", period: "2026-06", debitTotal: 100, creditTotal: 0, netBalance: 100 },
    ];
    const source: SourceBalance[] = [{ accountCode: "5000", netBalance: 95 }];
    const r = reconcile("b1", "2026-06", shadow, source);
    expect(r.matched).toBe(false);
    expect(r.variances[0].reason).toBe("amount_mismatch");
    expect(r.variances[0].delta).toBe(5);
  });

  it("tolerates a sub-cent rounding difference", () => {
    const shadow: AccountBalance[] = [
      { accountCode: "5000", period: "2026-06", debitTotal: 100.0, creditTotal: 0, netBalance: 100.0 },
    ];
    const source: SourceBalance[] = [{ accountCode: "5000", netBalance: 100.0 }];
    const r = reconcile("b1", "2026-06", shadow, source, DEFAULT_TOLERANCE);
    expect(r.matched).toBe(true);
  });

  it("flags missing_in_source (shadow has an account the source lacks)", () => {
    const shadow: AccountBalance[] = [
      { accountCode: "5100", period: "2026-06", debitTotal: 25, creditTotal: 0, netBalance: 25 },
    ];
    const r = reconcile("b1", "2026-06", shadow, []);
    expect(r.variances[0].reason).toBe("missing_in_source");
  });

  it("flags missing_in_shadow (source has an account the shadow lacks)", () => {
    const source: SourceBalance[] = [{ accountCode: "9999", netBalance: 10 }];
    const r = reconcile("b1", "2026-06", [], source);
    expect(r.variances[0].reason).toBe("missing_in_shadow");
  });

  it("only considers the requested period's shadow balances", () => {
    const shadow: AccountBalance[] = [
      { accountCode: "5000", period: "2026-05", debitTotal: 999, creditTotal: 0, netBalance: 999 },
      { accountCode: "5000", period: "2026-06", debitTotal: 100, creditTotal: 0, netBalance: 100 },
    ];
    const source: SourceBalance[] = [{ accountCode: "5000", netBalance: 100 }];
    const r = reconcile("b1", "2026-06", shadow, source);
    expect(r.matched).toBe(true); // May-999 ignored
  });

  it("end-to-end: shadow entries derived then reconciled against matching source", () => {
    const shadowEntries: JournalEntry[] = [
      buildJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-10",
        mode: "shadow",
        lines: [
          { accountCode: "5000", debit: 300 },
          { accountCode: "2000", credit: 300 },
        ],
      }),
    ];
    const shadowBalances = deriveBalances(shadowEntries, COA, { period: "2026-06", includeShadow: true });
    const source: SourceBalance[] = [
      { accountCode: "5000", netBalance: 300 },
      { accountCode: "2000", netBalance: 300 },
    ];
    const r = reconcile("b1", "2026-06", shadowBalances, source);
    expect(r.matched).toBe(true);
  });

  it("[property] identical shadow & source always reconcile clean", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            code: fc.string({ minLength: 1, maxLength: 4 }).filter((s) => s.trim().length > 0),
            net: fc.integer({ min: -1_000_000, max: 1_000_000 }).map((c) => c / 100),
          }),
          { minLength: 0, maxLength: 8 }
        ),
        (rows) => {
          // Dedupe by code (a COA has unique codes).
          const byCode = new Map(rows.map((r) => [r.code, r.net]));
          const shadow: AccountBalance[] = [...byCode].map(([code, net]) => ({
            accountCode: code,
            period: "2026-06",
            debitTotal: 0,
            creditTotal: 0,
            netBalance: net,
          }));
          const source: SourceBalance[] = [...byCode].map(([code, net]) => ({ accountCode: code, netBalance: net }));
          return reconcile("b1", "2026-06", shadow, source).matched;
        }
      )
    );
  });
});
