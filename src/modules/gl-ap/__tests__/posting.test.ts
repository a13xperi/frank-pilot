import fc from "fast-check";
import {
  buildJournalEntry,
  computeTieOut,
  deriveBalances,
  fromCents,
  InvalidLineError,
  isBalanced,
  netInNormalDirection,
  PeriodNotBalancedError,
  periodClose,
  periodOf,
  postJournalEntry,
  toCents,
  UnbalancedEntryError,
} from "../posting";
import { Account, JournalEntry } from "../types";

const COA: Pick<Account, "code" | "normalSide">[] = [
  { code: "1000", normalSide: "debit" }, // cash (asset)
  { code: "2000", normalSide: "credit" }, // AP (liability)
  { code: "5000", normalSide: "debit" }, // expense
  { code: "4000", normalSide: "credit" }, // revenue
];

describe("postJournalEntry — balance enforcement (the core law)", () => {
  it("accepts a balanced entry (Σdebits = Σcredits)", () => {
    const e = postJournalEntry({
      bookId: "b1",
      entryDate: "2026-06-18",
      lines: [
        { accountCode: "5000", debit: 100 },
        { accountCode: "2000", credit: 100 },
      ],
    });
    expect(e.status).toBe("posted");
    expect(e.period).toBe("2026-06");
    expect(e.lines).toHaveLength(2);
  });

  it("REJECTS an unbalanced entry with UnbalancedEntryError", () => {
    expect(() =>
      postJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000", debit: 100 },
          { accountCode: "2000", credit: 99 },
        ],
      })
    ).toThrow(UnbalancedEntryError);
  });

  it("rejects a one-line entry (cannot meaningfully balance)", () => {
    expect(() =>
      postJournalEntry({ bookId: "b1", entryDate: "2026-06-18", lines: [{ accountCode: "1000", debit: 10 }] })
    ).toThrow(InvalidLineError);
  });

  it("rejects a two-sided line (debit AND credit on one line)", () => {
    expect(() =>
      postJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000", debit: 50, credit: 50 },
          { accountCode: "2000", credit: 50 },
        ],
      })
    ).toThrow(/one-sided/);
  });

  it("rejects negative amounts (must use the opposite side)", () => {
    expect(() =>
      postJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000", debit: -100 },
          { accountCode: "2000", credit: -100 },
        ],
      })
    ).toThrow(/negative/);
  });

  it("rejects an empty line (no debit or credit)", () => {
    expect(() =>
      postJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000" },
          { accountCode: "2000", credit: 0 },
        ],
      })
    ).toThrow(/empty/);
  });

  it("handles multi-line splits that still balance", () => {
    const e = postJournalEntry({
      bookId: "b1",
      entryDate: "2026-06-18",
      lines: [
        { accountCode: "5000", debit: 70 },
        { accountCode: "5000", debit: 30 },
        { accountCode: "2000", credit: 100 },
      ],
    });
    expect(e.lines).toHaveLength(3);
  });

  it("is exact on fractional cents (no float drift): 0.10 + 0.20 == 0.30", () => {
    expect(
      isBalanced({
        bookId: "b1",
        entryDate: "2026-06-18",
        lines: [
          { accountCode: "5000", debit: 0.1 },
          { accountCode: "5000", debit: 0.2 },
          { accountCode: "2000", credit: 0.3 },
        ],
      })
    ).toBe(true);
  });

  it("rejects an invalid entryDate format", () => {
    expect(() => periodOf("June 18 2026")).toThrow(/ISO/);
  });

  // Property: any set of debit-only lines plus a single balancing credit line
  // always balances and is accepted.
  it("[property] balanced-by-construction entries are always accepted", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
        (debitCents) => {
          const total = debitCents.reduce((a, b) => a + b, 0);
          const lines = [
            ...debitCents.map((c) => ({ accountCode: "5000", debit: fromCents(c) })),
            { accountCode: "2000", credit: fromCents(total) },
          ];
          return isBalanced({ bookId: "b1", entryDate: "2026-06-18", lines });
        }
      )
    );
  });

  // Property: nudging the credit by a single cent always breaks the balance.
  it("[property] a one-cent imbalance is always rejected", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (cents) => {
        const lines = [
          { accountCode: "5000", debit: fromCents(cents) },
          { accountCode: "2000", credit: fromCents(cents + 1) },
        ];
        return !isBalanced({ bookId: "b1", entryDate: "2026-06-18", lines });
      })
    );
  });
});

describe("toCents/fromCents", () => {
  it("round-trips cleanly", () => {
    expect(toCents(123.45)).toBe(12345);
    expect(fromCents(12345)).toBe(123.45);
    expect(fromCents(toCents(0.07))).toBe(0.07);
  });
});

describe("netInNormalDirection", () => {
  it("debit-normal nets debit − credit", () => {
    expect(netInNormalDirection(100, 30, "debit")).toBe(70);
  });
  it("credit-normal nets credit − debit", () => {
    expect(netInNormalDirection(30, 100, "credit")).toBe(70);
  });
});

describe("deriveBalances", () => {
  const entries: JournalEntry[] = [
    buildJournalEntry({
      bookId: "b1",
      entryDate: "2026-06-01",
      lines: [
        { accountCode: "5000", debit: 100 },
        { accountCode: "2000", credit: 100 },
      ],
    }),
    buildJournalEntry({
      bookId: "b1",
      entryDate: "2026-06-15",
      lines: [
        { accountCode: "2000", debit: 40 },
        { accountCode: "1000", credit: 40 },
      ],
    }),
  ];

  it("nets per account in normal direction", () => {
    const bal = deriveBalances(entries, COA, { period: "2026-06" });
    const ap = bal.find((b) => b.accountCode === "2000")!;
    // AP credit-normal: credited 100, debited 40 → net 60
    expect(ap.netBalance).toBe(60);
    const exp = bal.find((b) => b.accountCode === "5000")!;
    expect(exp.netBalance).toBe(100);
  });

  it("excludes shadow entries from live balances by default", () => {
    const withShadow = [
      ...entries,
      buildJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-20",
        mode: "shadow",
        lines: [
          { accountCode: "5000", debit: 999 },
          { accountCode: "2000", credit: 999 },
        ],
      }),
    ];
    const live = deriveBalances(withShadow, COA, { period: "2026-06" });
    expect(live.find((b) => b.accountCode === "5000")!.netBalance).toBe(100); // shadow 999 excluded
  });

  it("excludes draft entries", () => {
    const withDraft = [...entries, { ...entries[0], status: "draft" as const, lines: entries[0].lines }];
    const bal = deriveBalances(withDraft, COA, { period: "2026-06" });
    expect(bal.find((b) => b.accountCode === "5000")!.netBalance).toBe(100);
  });
});

describe("computeTieOut / periodClose", () => {
  it("ties out a balanced period and allows close", () => {
    const entries = [
      buildJournalEntry({
        bookId: "b1",
        entryDate: "2026-06-01",
        lines: [
          { accountCode: "5000", debit: 100 },
          { accountCode: "2000", credit: 100 },
        ],
      }),
    ];
    const tie = computeTieOut(entries, COA, "2026-06");
    expect(tie.balanced).toBe(true);
    expect(tie.debitTotal).toBe(100);
    expect(tie.creditTotal).toBe(100);
    expect(() => periodClose(entries, COA, "2026-06")).not.toThrow();
  });

  it("[property] any set of balanced posted entries ties out", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 10 }),
        (amts) => {
          const entries = amts.map((c) =>
            buildJournalEntry({
              bookId: "b1",
              entryDate: "2026-06-10",
              lines: [
                { accountCode: "5000", debit: fromCents(c) },
                { accountCode: "2000", credit: fromCents(c) },
              ],
            })
          );
          return computeTieOut(entries, COA, "2026-06").balanced;
        }
      )
    );
  });
});
