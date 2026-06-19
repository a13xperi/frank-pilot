/**
 * B3 — Entity-level GL/AP ledger: shared types for the GENERIC double-entry
 * foundation.
 *
 * Everything here is universal to any double-entry GL/AP system. Nothing encodes
 * a Frank/GPM-specific account or posting rule — those arrive as DATA (the
 * chart-of-accounts rows + the posting-rules config) from Tanya's 8-step intake
 * (docs/deals/TANYA-GL-INTAKE.md).
 *
 * Amounts are plain `number` of MAJOR currency units (dollars) at the type
 * layer; the DB stores NUMERIC(18,2). The pure engine works in integer CENTS
 * internally to avoid float drift (see posting.ts).
 */

export type NormalSide = "debit" | "credit";

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

export type EntryStatus = "draft" | "posted" | "reversed";

/** `shadow` entries are parallel-run only and are NEVER system-of-record. */
export type EntryMode = "live" | "shadow";

export type PeriodStatus = "open" | "locked";

// ── Chart of accounts ────────────────────────────────────────────────────────

export interface Account {
  code: string;
  name: string;
  accountType: AccountType;
  normalSide: NormalSide;
  parentCode?: string | null;
  isActive?: boolean;
  isPlaceholder?: boolean;
}

/** The standard normal side for each account type, per the accounting equation. */
export const NORMAL_SIDE_BY_TYPE: Record<AccountType, NormalSide> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
};

// ── Journal entries + lines ──────────────────────────────────────────────────

export interface JournalLineInput {
  accountCode: string;
  /** Major units (dollars). Exactly one of debit/credit is > 0 per line. */
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface JournalEntryInput {
  bookId: string;
  /** ISO date 'YYYY-MM-DD'. The period 'YYYY-MM' is derived from it. */
  entryDate: string;
  lines: JournalLineInput[];
  memo?: string;
  mode?: EntryMode; // default 'live'
  sourceType?: string;
  sourceRef?: string;
  postingRuleId?: string;
}

export interface JournalLine extends Required<Pick<JournalLineInput, "accountCode">> {
  lineNo: number;
  debit: number;
  credit: number;
  memo?: string | null;
}

export interface JournalEntry {
  id?: string;
  bookId: string;
  entryDate: string;
  period: string;
  status: EntryStatus;
  mode: EntryMode;
  memo?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  postingRuleId?: string | null;
  lines: JournalLine[];
}

// ── Balances / period close ──────────────────────────────────────────────────

export interface AccountBalance {
  accountCode: string;
  period: string;
  debitTotal: number;
  creditTotal: number;
  /** Net in the account's NORMAL direction. */
  netBalance: number;
}

export interface TieOut {
  period: string;
  debitTotal: number;
  creditTotal: number;
  balanced: boolean;
  accountCount: number;
  byAccount: AccountBalance[];
}

// ── AP ───────────────────────────────────────────────────────────────────────

export type ApBillStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "scheduled"
  | "partially_paid"
  | "paid"
  | "voided";

export interface ApBill {
  id?: string;
  bookId: string;
  vendorId?: string | null;
  billNumber?: string | null;
  status: ApBillStatus;
  amount: number;
  amountPaid: number;
  sourceDocType: string;
  billDate?: string | null;
  dueDate?: string | null;
  memo?: string | null;
  sourceRef?: string | null;
}

export interface ApPayment {
  id?: string;
  billId: string;
  bookId: string;
  amount: number;
  paymentDate?: string | null;
  method?: string | null;
  reference?: string | null;
  sourceDocType: string;
  sourceRef?: string | null;
}

// ── Posting rules (config-driven — the slot for Tanya's 8 steps) ──────────────

/**
 * Maps a source document type → the Debit/Credit account pair to post. This is
 * the structure Tanya's 8-step process populates (the "Journal entry (Debit →
 * Credit acct)" column). Rules are loaded from a CONFIG file, never hardcoded.
 *
 * The amount side that resolves to the bill/payment total is driven by
 * `amountSource`. Accounts are referenced BY CODE so a rule set is portable
 * across books that share a numbering scheme.
 */
export interface PostingRule {
  /** Stable id, referenced from gl_journal_entries.posting_rule_id. */
  id: string;
  /** The source document type this rule fires on, e.g. 'vendor_invoice'. */
  sourceDocType: string;
  description?: string;
  /** Account code to DEBIT. */
  debitAccount: string;
  /** Account code to CREDIT. */
  creditAccount: string;
  /**
   * Where the posted amount comes from on the source doc. Generic, additive:
   * 'amount' (gross/total) is the universal default; deployments may extend.
   */
  amountSource?: "amount" | "amount_paid" | "balance_due";
  /** Optional further match (e.g. vendor category) — generic key/value. */
  match?: Record<string, string>;
}

export interface PostingRuleSet {
  /** Free-form version tag for the rule set. */
  version: string;
  /** TRUE for the shipped placeholder set; flip when Tanya's rules are loaded. */
  placeholder: boolean;
  source?: string;
  rules: PostingRule[];
}

// ── Parallel-run reconciliation ──────────────────────────────────────────────

/** One account's figure from the existing system-of-record (the comparison input). */
export interface SourceBalance {
  accountCode: string;
  /** Net balance in the account's normal direction, major units. */
  netBalance: number;
}

export interface ReconciliationVariance {
  accountCode: string;
  shadow: number;
  source: number;
  /** shadow − source. Zero (within tolerance) = matched. */
  delta: number;
  reason: "matched" | "amount_mismatch" | "missing_in_source" | "missing_in_shadow";
}

export interface ReconciliationReport {
  bookId: string;
  period: string;
  matched: boolean;
  varianceCount: number;
  variances: ReconciliationVariance[];
  shadowTotal: number;
  sourceTotal: number;
}
