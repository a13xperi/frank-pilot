/**
 * B3 — Config-driven posting rules: loader + application (pure).
 *
 * A PostingRule maps a source-document type → the Debit/Credit account pair to
 * post. Rules are LOADED FROM A CONFIG FILE, never hardcoded — this is exactly
 * where Tanya's 8-step process (docs/deals/TANYA-GL-INTAKE.md) populates the
 * ledger's behavior. Ship: the loader + a documented PLACEHOLDER rule set
 * (config/posting-rules.placeholder.json). Going live = swapping the config,
 * not editing code.
 *
 * Pure module: no DB. `applyPostingRule` turns a source document + a rule into a
 * balanced JournalEntryInput, which postJournalEntry() then validates.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Account,
  JournalEntryInput,
  PostingRule,
  PostingRuleSet,
} from "./types";
import { InvalidLineError } from "./posting";

const CONFIG_DIR = join(__dirname, "config");
export const PLACEHOLDER_RULES_PATH = join(CONFIG_DIR, "posting-rules.placeholder.json");
export const PLACEHOLDER_COA_PATH = join(CONFIG_DIR, "chart-of-accounts.placeholder.json");

export class PostingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingRuleError";
  }
}

/** Minimal shape-validate a parsed rule set (no schema lib dependency at load). */
function assertRuleSet(obj: unknown, path: string): PostingRuleSet {
  const rs = obj as Partial<PostingRuleSet>;
  if (!rs || typeof rs !== "object" || !Array.isArray(rs.rules)) {
    throw new PostingRuleError(`Invalid posting-rule set at ${path}: missing 'rules' array`);
  }
  const ids = new Set<string>();
  for (const r of rs.rules) {
    if (!r.id || !r.sourceDocType || !r.debitAccount || !r.creditAccount) {
      throw new PostingRuleError(
        `Invalid rule in ${path}: each rule needs id, sourceDocType, debitAccount, creditAccount ` +
          `(offending: ${JSON.stringify(r)})`
      );
    }
    if (r.debitAccount === r.creditAccount) {
      throw new PostingRuleError(
        `Rule '${r.id}' debits and credits the same account (${r.debitAccount}); ` +
          `a posting rule must move value between two accounts`
      );
    }
    if (ids.has(r.id)) {
      throw new PostingRuleError(`Duplicate posting-rule id '${r.id}' in ${path}`);
    }
    ids.add(r.id);
  }
  return {
    version: rs.version ?? "unversioned",
    placeholder: rs.placeholder ?? false,
    source: rs.source,
    rules: rs.rules as PostingRule[],
  };
}

/**
 * Load a posting-rule set from a JSON config file. Defaults to the shipped
 * PLACEHOLDER set. Point `path` at Tanya's transcribed rules to go live.
 */
export function loadPostingRules(path: string = PLACEHOLDER_RULES_PATH): PostingRuleSet {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new PostingRuleError(`Cannot read posting-rule config at ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PostingRuleError(`Posting-rule config at ${path} is not valid JSON: ${(e as Error).message}`);
  }
  return assertRuleSet(parsed, path);
}

/** Load a chart of accounts from a JSON config file (defaults to PLACEHOLDER). */
export function loadChartOfAccounts(path: string = PLACEHOLDER_COA_PATH): {
  version: string;
  placeholder: boolean;
  accounts: Account[];
} {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new PostingRuleError(`Cannot read chart-of-accounts config at ${path}: ${(e as Error).message}`);
  }
  const parsed = JSON.parse(raw) as {
    version?: string;
    placeholder?: boolean;
    accounts?: Account[];
  };
  if (!Array.isArray(parsed.accounts)) {
    throw new PostingRuleError(`Invalid chart-of-accounts config at ${path}: missing 'accounts' array`);
  }
  return {
    version: parsed.version ?? "unversioned",
    placeholder: parsed.placeholder ?? false,
    accounts: parsed.accounts,
  };
}

/** Index a rule set by source-doc-type for O(1) lookup. Last rule wins on ties. */
export function indexRules(ruleSet: PostingRuleSet): Map<string, PostingRule> {
  const map = new Map<string, PostingRule>();
  for (const r of ruleSet.rules) map.set(r.sourceDocType, r);
  return map;
}

/** Find the rule that applies to a source-doc-type, or null. */
export function resolveRule(
  ruleSet: PostingRuleSet,
  sourceDocType: string
): PostingRule | null {
  return ruleSet.rules.find((r) => r.sourceDocType === sourceDocType) ?? null;
}

export interface SourceDocument {
  bookId: string;
  sourceDocType: string;
  entryDate: string;
  /** The candidate amounts a rule's amountSource may select from. */
  amount: number;
  amountPaid?: number;
  balanceDue?: number;
  sourceRef?: string;
  memo?: string;
  mode?: "live" | "shadow";
}

/**
 * Apply a posting rule to a source document, producing a balanced two-line
 * JournalEntryInput (Dr the rule's debitAccount, Cr its creditAccount, for the
 * rule-selected amount). The result still flows through postJournalEntry() for
 * the balance check (it's balanced by construction here, but the choke-point is
 * never bypassed). Throws if no rule matches or the amount is non-positive.
 */
export function applyPostingRule(
  ruleSet: PostingRuleSet,
  doc: SourceDocument
): JournalEntryInput {
  const rule = resolveRule(ruleSet, doc.sourceDocType);
  if (!rule) {
    throw new PostingRuleError(
      `No posting rule for source-doc-type '${doc.sourceDocType}' in rule set ` +
        `'${ruleSet.version}'. Add it (this is a TANYA-GL-INTAKE step).`
    );
  }

  const amount = selectAmount(rule, doc);
  if (!(amount > 0)) {
    throw new InvalidLineError(
      `Posting rule '${rule.id}' resolved a non-positive amount (${amount}) for ${doc.sourceDocType}`
    );
  }

  return {
    bookId: doc.bookId,
    entryDate: doc.entryDate,
    mode: doc.mode ?? "live",
    memo: doc.memo ?? rule.description ?? `${doc.sourceDocType} via ${rule.id}`,
    sourceType: doc.sourceDocType,
    sourceRef: doc.sourceRef,
    postingRuleId: rule.id,
    lines: [
      { accountCode: rule.debitAccount, debit: amount },
      { accountCode: rule.creditAccount, credit: amount },
    ],
  };
}

function selectAmount(rule: PostingRule, doc: SourceDocument): number {
  switch (rule.amountSource ?? "amount") {
    case "amount":
      return doc.amount;
    case "amount_paid":
      return doc.amountPaid ?? 0;
    case "balance_due":
      return doc.balanceDue ?? 0;
    default:
      return doc.amount;
  }
}
