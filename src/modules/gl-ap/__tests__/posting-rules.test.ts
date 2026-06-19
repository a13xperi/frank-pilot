import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPostingRule,
  indexRules,
  loadChartOfAccounts,
  loadPostingRules,
  PLACEHOLDER_COA_PATH,
  PLACEHOLDER_RULES_PATH,
  PostingRuleError,
  resolveRule,
} from "../posting-rules";
import { isBalanced, postJournalEntry } from "../posting";
import { PostingRuleSet } from "../types";

describe("posting-rules loader (config-driven)", () => {
  it("loads the shipped PLACEHOLDER rule set and flags it as placeholder", () => {
    const rs = loadPostingRules();
    expect(rs.placeholder).toBe(true);
    expect(rs.rules.length).toBeGreaterThan(0);
    // Every rule has the required shape.
    for (const r of rs.rules) {
      expect(r.id).toBeTruthy();
      expect(r.sourceDocType).toBeTruthy();
      expect(r.debitAccount).toBeTruthy();
      expect(r.creditAccount).toBeTruthy();
      expect(r.debitAccount).not.toBe(r.creditAccount);
    }
  });

  it("loads the PLACEHOLDER chart of accounts (all flagged placeholder)", () => {
    const coa = loadChartOfAccounts();
    expect(coa.placeholder).toBe(true);
    expect(coa.accounts.length).toBeGreaterThan(0);
    expect(coa.accounts.every((a) => a.isPlaceholder)).toBe(true);
    // Normal sides are internally consistent with type for the standard rows.
    const ap = coa.accounts.find((a) => a.code === "2000")!;
    expect(ap.accountType).toBe("liability");
    expect(ap.normalSide).toBe("credit");
  });

  it("placeholder config paths exist and parse", () => {
    expect(() => loadPostingRules(PLACEHOLDER_RULES_PATH)).not.toThrow();
    expect(() => loadChartOfAccounts(PLACEHOLDER_COA_PATH)).not.toThrow();
  });

  it("rejects a config with a rule that debits == credits", () => {
    const dir = mkdtempSync(join(tmpdir(), "glap-rules-"));
    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify({
        version: "x",
        placeholder: false,
        rules: [{ id: "r1", sourceDocType: "d", debitAccount: "1000", creditAccount: "1000" }],
      })
    );
    expect(() => loadPostingRules(bad)).toThrow(PostingRuleError);
  });

  it("rejects a config with duplicate rule ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "glap-rules-"));
    const bad = join(dir, "dup.json");
    writeFileSync(
      bad,
      JSON.stringify({
        version: "x",
        placeholder: false,
        rules: [
          { id: "r1", sourceDocType: "a", debitAccount: "1", creditAccount: "2" },
          { id: "r1", sourceDocType: "b", debitAccount: "3", creditAccount: "4" },
        ],
      })
    );
    expect(() => loadPostingRules(bad)).toThrow(/Duplicate/);
  });

  it("rejects a malformed config (no rules array)", () => {
    const dir = mkdtempSync(join(tmpdir(), "glap-rules-"));
    const bad = join(dir, "empty.json");
    writeFileSync(bad, JSON.stringify({ version: "x" }));
    expect(() => loadPostingRules(bad)).toThrow(PostingRuleError);
  });

  it("rejects a missing file with a clear error", () => {
    expect(() => loadPostingRules("/no/such/file.json")).toThrow(/Cannot read/);
  });
});

describe("applyPostingRule (rule → balanced entry)", () => {
  const rs = loadPostingRules();

  it("turns a vendor_invoice into a balanced Dr/Cr entry per the rule", () => {
    const entry = applyPostingRule(rs, {
      bookId: "b1",
      sourceDocType: "vendor_invoice",
      entryDate: "2026-06-18",
      amount: 250.5,
      sourceRef: "INV-1",
    });
    expect(entry.lines).toHaveLength(2);
    // Whatever the placeholder maps to, the entry must balance and carry the rule id.
    expect(isBalanced(entry)).toBe(true);
    expect(entry.postingRuleId).toBeTruthy();
    // And it survives the posting choke-point.
    expect(() => postJournalEntry(entry)).not.toThrow();
  });

  it("Dr and Cr are the rule's accounts, for the doc amount", () => {
    const rule = resolveRule(rs, "vendor_payment")!;
    const entry = applyPostingRule(rs, {
      bookId: "b1",
      sourceDocType: "vendor_payment",
      entryDate: "2026-06-18",
      amount: 99.99,
    });
    const dr = entry.lines.find((l) => l.debit && l.debit > 0)!;
    const cr = entry.lines.find((l) => l.credit && l.credit > 0)!;
    expect(dr.accountCode).toBe(rule.debitAccount);
    expect(cr.accountCode).toBe(rule.creditAccount);
    expect(dr.debit).toBe(99.99);
    expect(cr.credit).toBe(99.99);
  });

  it("throws when no rule matches the source-doc-type (a TANYA step is missing)", () => {
    expect(() =>
      applyPostingRule(rs, {
        bookId: "b1",
        sourceDocType: "totally_unknown_doc",
        entryDate: "2026-06-18",
        amount: 10,
      })
    ).toThrow(/No posting rule/);
  });

  it("respects amountSource (amount_paid)", () => {
    const customRs: PostingRuleSet = {
      version: "test",
      placeholder: false,
      rules: [
        {
          id: "pay-by-paid",
          sourceDocType: "partial_pay",
          debitAccount: "2000",
          creditAccount: "1000",
          amountSource: "amount_paid",
        },
      ],
    };
    const entry = applyPostingRule(customRs, {
      bookId: "b1",
      sourceDocType: "partial_pay",
      entryDate: "2026-06-18",
      amount: 500,
      amountPaid: 200,
    });
    expect(entry.lines.find((l) => l.debit)!.debit).toBe(200);
  });

  it("rejects a non-positive resolved amount", () => {
    const rs2: PostingRuleSet = {
      version: "t",
      placeholder: false,
      rules: [{ id: "z", sourceDocType: "zero", debitAccount: "5000", creditAccount: "2000" }],
    };
    expect(() =>
      applyPostingRule(rs2, { bookId: "b1", sourceDocType: "zero", entryDate: "2026-06-18", amount: 0 })
    ).toThrow(/non-positive/);
  });

  it("indexRules builds a doc-type → rule map", () => {
    const idx = indexRules(rs);
    expect(idx.get("vendor_invoice")).toBeTruthy();
  });
});
