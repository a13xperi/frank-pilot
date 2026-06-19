/**
 * B3 — Pure double-entry posting engine (DB-free, fully unit-testable).
 *
 * This is the universal core of any GL: it knows nothing about Frank, GPM, or
 * any specific chart of accounts. It enforces the one law every double-entry
 * ledger obeys — **every entry must balance: Σdebits = Σcredits** — and derives
 * balances + a period tie-out from posted entries.
 *
 * Money is handled in integer CENTS internally so balance checks are exact (no
 * float epsilon). Inputs/outputs are major units (dollars) to match the rest of
 * the codebase and the NUMERIC(18,2) columns. The service layer (service.ts)
 * persists what this module validates, inside a transaction, with the DB-level
 * constraint trigger as a second backstop.
 */

import {
  AccountBalance,
  Account,
  JournalEntry,
  JournalEntryInput,
  JournalLine,
  NormalSide,
  TieOut,
} from "./types";

export class UnbalancedEntryError extends Error {
  constructor(
    public readonly debitTotal: number,
    public readonly creditTotal: number
  ) {
    super(
      `Unbalanced journal entry: debits=${debitTotal.toFixed(2)} ` +
        `credits=${creditTotal.toFixed(2)} (difference ${(debitTotal - creditTotal).toFixed(2)})`
    );
    this.name = "UnbalancedEntryError";
  }
}

export class InvalidLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLineError";
  }
}

/** Dollars → integer cents, rounded half-away-from-zero. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new InvalidLineError(`Amount is not a finite number: ${amount}`);
  }
  return Math.round(amount * 100);
}

/** Integer cents → dollars. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Derive the accounting period 'YYYY-MM' from an ISO 'YYYY-MM-DD' date. */
export function periodOf(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) {
    throw new InvalidLineError(`entryDate must be ISO YYYY-MM-DD, got: ${isoDate}`);
  }
  return `${m[1]}-${m[2]}`;
}

/**
 * Validate + normalize an entry's lines into the canonical balanced shape, or
 * throw. This is the gate `postJournalEntry` runs BEFORE any persistence.
 *
 * Rules enforced:
 *   - at least two lines (a single-line entry can never balance meaningfully);
 *   - each line is one-sided (not both debit and credit) and non-empty;
 *   - no negative amounts (use the opposite side instead);
 *   - Σdebits === Σcredits (in cents — exact).
 */
export function validateEntry(input: JournalEntryInput): {
  lines: JournalLine[];
  debitTotal: number;
  creditTotal: number;
} {
  if (!input.lines || input.lines.length < 2) {
    throw new InvalidLineError(
      `A journal entry needs at least 2 lines; got ${input.lines?.length ?? 0}`
    );
  }

  let debitCents = 0;
  let creditCents = 0;
  const lines: JournalLine[] = [];

  input.lines.forEach((raw, i) => {
    const debit = raw.debit ?? 0;
    const credit = raw.credit ?? 0;

    if (debit < 0 || credit < 0) {
      throw new InvalidLineError(
        `Line ${i + 1} (${raw.accountCode}) has a negative amount; ` +
          `post to the opposite side instead`
      );
    }
    if (debit > 0 && credit > 0) {
      throw new InvalidLineError(
        `Line ${i + 1} (${raw.accountCode}) is two-sided (debit AND credit); a line must be one-sided`
      );
    }
    if (debit === 0 && credit === 0) {
      throw new InvalidLineError(
        `Line ${i + 1} (${raw.accountCode}) is empty (no debit or credit)`
      );
    }
    if (!raw.accountCode) {
      throw new InvalidLineError(`Line ${i + 1} is missing an accountCode`);
    }

    const dCents = toCents(debit);
    const cCents = toCents(credit);
    debitCents += dCents;
    creditCents += cCents;

    lines.push({
      lineNo: i + 1,
      accountCode: raw.accountCode,
      debit: fromCents(dCents),
      credit: fromCents(cCents),
      memo: raw.memo ?? null,
    });
  });

  if (debitCents !== creditCents) {
    throw new UnbalancedEntryError(fromCents(debitCents), fromCents(creditCents));
  }

  return {
    lines,
    debitTotal: fromCents(debitCents),
    creditTotal: fromCents(creditCents),
  };
}

/**
 * Build a validated, balanced JournalEntry in 'draft'/'posted' shape from input.
 * This is the PURE half of posting — it rejects unbalanced entries. The service
 * persists the result. `status` defaults to 'posted' because the act of posting
 * is what this represents; callers wanting a draft can override.
 */
export function buildJournalEntry(
  input: JournalEntryInput,
  status: JournalEntry["status"] = "posted"
): JournalEntry {
  const { lines } = validateEntry(input);
  return {
    bookId: input.bookId,
    entryDate: input.entryDate,
    period: periodOf(input.entryDate),
    status,
    mode: input.mode ?? "live",
    memo: input.memo ?? null,
    sourceType: input.sourceType ?? null,
    sourceRef: input.sourceRef ?? null,
    postingRuleId: input.postingRuleId ?? null,
    lines,
  };
}

/**
 * Post a journal entry: validate balance, then return the canonical entry. This
 * is the single pure choke-point — REJECTS any unbalanced entry by throwing
 * UnbalancedEntryError. Persistence is the service's job; keeping this pure
 * means the balance law is enforced identically in tests, shadow runs, and live.
 */
export function postJournalEntry(input: JournalEntryInput): JournalEntry {
  return buildJournalEntry(input, "posted");
}

/** True if the entry's lines balance, without throwing. */
export function isBalanced(input: JournalEntryInput): boolean {
  try {
    validateEntry(input);
    return true;
  } catch (e) {
    if (e instanceof UnbalancedEntryError || e instanceof InvalidLineError) {
      return false;
    }
    throw e;
  }
}

/** Net a debit/credit pair into the account's normal direction (major units). */
export function netInNormalDirection(
  debitTotal: number,
  creditTotal: number,
  normalSide: NormalSide
): number {
  const net =
    normalSide === "debit"
      ? toCents(debitTotal) - toCents(creditTotal)
      : toCents(creditTotal) - toCents(debitTotal);
  return fromCents(net);
}

/**
 * Derive per-account balances for a period from a set of POSTED entries.
 *
 * Pure: pass in the entries and the chart (for normal sides). Only entries that
 * are `status === 'posted'` AND `mode === 'live'` count toward the books —
 * shadow + draft entries are excluded by construction, so a parallel run never
 * pollutes real balances. Pass `{ includeShadow: true }` to derive a shadow
 * book's balances for reconciliation.
 */
export function deriveBalances(
  entries: JournalEntry[],
  accounts: Pick<Account, "code" | "normalSide">[],
  opts: { period?: string; includeShadow?: boolean } = {}
): AccountBalance[] {
  const normalByCode = new Map<string, NormalSide>(
    accounts.map((a) => [a.code, a.normalSide])
  );
  // Accumulate in cents per (account, period).
  const acc = new Map<string, { period: string; debit: number; credit: number }>();

  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    const wantMode = opts.includeShadow ? entry.mode : "live";
    if (entry.mode !== wantMode) continue;
    if (opts.period && entry.period !== opts.period) continue;

    for (const line of entry.lines) {
      const key = `${line.accountCode}|${entry.period}`;
      const cur = acc.get(key) ?? { period: entry.period, debit: 0, credit: 0 };
      cur.debit += toCents(line.debit);
      cur.credit += toCents(line.credit);
      acc.set(key, cur);
    }
  }

  const out: AccountBalance[] = [];
  for (const [key, v] of acc) {
    const accountCode = key.split("|")[0];
    const normalSide = normalByCode.get(accountCode) ?? "debit";
    out.push({
      accountCode,
      period: v.period,
      debitTotal: fromCents(v.debit),
      creditTotal: fromCents(v.credit),
      netBalance: netInNormalDirection(
        fromCents(v.debit),
        fromCents(v.credit),
        normalSide
      ),
    });
  }
  // Stable order: by account code then period.
  out.sort((a, b) =>
    a.accountCode === b.accountCode
      ? a.period.localeCompare(b.period)
      : a.accountCode.localeCompare(b.accountCode)
  );
  return out;
}

/**
 * Compute a period tie-out from posted live entries: total debits, total
 * credits, whether they balance, and the per-account breakdown. periodClose
 * uses this to decide whether a period may be locked — the books only close if
 * the whole period balances (the trial-balance check).
 */
export function computeTieOut(
  entries: JournalEntry[],
  accounts: Pick<Account, "code" | "normalSide">[],
  period: string
): TieOut {
  const byAccount = deriveBalances(entries, accounts, { period });
  let debitCents = 0;
  let creditCents = 0;
  for (const b of byAccount) {
    debitCents += toCents(b.debitTotal);
    creditCents += toCents(b.creditTotal);
  }
  return {
    period,
    debitTotal: fromCents(debitCents),
    creditTotal: fromCents(creditCents),
    balanced: debitCents === creditCents,
    accountCount: byAccount.length,
    byAccount,
  };
}

export class PeriodNotBalancedError extends Error {
  constructor(public readonly tieOut: TieOut) {
    super(
      `Cannot close period ${tieOut.period}: it does not tie out ` +
        `(debits=${tieOut.debitTotal.toFixed(2)} credits=${tieOut.creditTotal.toFixed(2)})`
    );
    this.name = "PeriodNotBalancedError";
  }
}

/**
 * Pure period-close decision: returns the tie-out if the period balances, else
 * throws PeriodNotBalancedError. The service applies the actual lock + snapshot
 * when this succeeds. Locking is the GENERIC guard ("no postings into a closed
 * period"); the service enforces it on the way IN to postJournalEntry.
 */
export function periodClose(
  entries: JournalEntry[],
  accounts: Pick<Account, "code" | "normalSide">[],
  period: string
): TieOut {
  const tieOut = computeTieOut(entries, accounts, period);
  if (!tieOut.balanced) {
    throw new PeriodNotBalancedError(tieOut);
  }
  return tieOut;
}
