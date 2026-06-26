/**
 * deal-qa-compartment-guard.test.ts — the compartment mask is the boundary that
 * keeps the deal's withhold set out of a partner's unsupervised Telegram answers.
 * If a class regex regresses, privileged data leaks — so every class, every
 * translation gotcha, and the fail-closed contract are pinned here.
 *
 * Source of truth: battlestation scripts/claw.py (_GUARD_CLASSES / TIER_BANNED /
 * guard_answer) + daemons/dealroom-telegram.py (effective_tier).
 */
import {
  guardAnswer,
  effectiveTier,
  bannedClasses,
  isDealTier,
  GUARD_CLASS_IDS,
  normalizeBrand,
  type DealTier,
} from "../modules/deal-qa/compartment-guard";

const SCOPED = "[scoped]";

describe("compartment guard — per-class masking at privileged (Slater)", () => {
  // One representative leaking sentence per masked class at the privileged tier.
  // If a class is added without a case here, the coverage test below fails.
  const LEAKS: Array<[string, string]> = [
    ["names", "The BESS vendor is Honeywell and Wadsworth runs the site."],
    ["cap", "Frank holds 51% per the cap table."],
    ["econ", "The raise is $700,000 at 88¢ per credit."],
  ];

  it.each(LEAKS)("%s: masks the token to [scoped] and records the class", (id, leak) => {
    const g = guardAnswer(leak, "privileged");
    expect(g.blocked).toBeFalsy();
    expect(g.clean).toBe(false);
    expect(g.hits).toContain(id);
    expect(g.masked).toContain(SCOPED);
  });

  it("every privileged-banned class has a pinned leak case (no untested class)", () => {
    const pinned = new Set(LEAKS.map(([id]) => id));
    for (const cls of bannedClasses("privileged")) {
      expect(pinned.has(cls)).toBe(true);
    }
  });

  it("specific names are masked but the token survives nowhere", () => {
    const g = guardAnswer("Talk to Mohammad Hoda and Ebru Arslan about the BESS.", "privileged");
    expect(g.hits).toContain("names");
    expect(g.masked).not.toMatch(/Honeywell|Wadsworth|Hoda|Arslan|Donna|Kyle|Ritchie/i);
  });

  it("Alex is never masked (partner deals with Alex directly)", () => {
    const g = guardAnswer("Alex will walk you through the structure.", "privileged");
    expect(g.clean).toBe(true);
    expect(g.masked).toContain("Alex");
  });
});

describe("compartment guard — translation gotchas (each one is a leak if wrong)", () => {
  it("GLOBAL replace: every $ occurrence is masked, not just the first", () => {
    // The dangerous Python→JS port: without the `g` flag only "$5,000" masks and
    // "$700,000" leaks. Both must be gone.
    const g = guardAnswer("First $5,000 and later $700,000 total.", "privileged");
    expect(g.masked).not.toMatch(/\$\s?\d/);
    expect((g.masked.match(/\[scoped\]/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("idempotent: guarding twice yields identical output (no lastIndex bleed)", () => {
    const text = "Frank owns 51% and the raise is $700,000.";
    const once = guardAnswer(text, "privileged").masked;
    const twice = guardAnswer(text, "privileged").masked;
    expect(once).toBe(twice);
    // And re-guarding an already-masked answer never un-masks or double-mangles.
    expect(guardAnswer(once, "privileged").masked).toBe(once);
  });

  it("case-insensitive: lowercase FEOC is caught at ext-named", () => {
    const g = guardAnswer("the feoc exposure", "ext-named");
    expect(g.hits).toContain("risk_legal");
    expect(g.masked).not.toMatch(/feoc/i);
  });

  it("word boundary: masks the name, not benign substrings", () => {
    const g = guardAnswer("Wadsworth leads it.", "privileged");
    expect(g.masked).not.toMatch(/Wadsworth/);
    // A non-listed word that merely contains listed letters is untouched.
    const benign = guardAnswer("The kylie color palette is fine.", "privileged");
    expect(benign.clean).toBe(true);
  });

  it("econ variants: cents, ranges, participating instrument, $ with k/M", () => {
    for (const leak of [
      "priced at 90¢",
      "the 88–92¢ band",
      "a participating debt note",
      "around $13M of capex",
    ]) {
      const g = guardAnswer(leak, "privileged");
      expect(g.hits).toContain("econ");
      expect(g.masked).toContain(SCOPED);
    }
  });

  it("cap variants: 51%, cap-table, founder-owned reveal", () => {
    for (const leak of ["Frank's 51 %", "the cap-table split", "it's 100% founder-owned"]) {
      const g = guardAnswer(leak, "privileged");
      expect(g.hits).toContain("cap");
    }
  });

  it("risk_legal variants: §385, Section 385, 7701(e)(4)", () => {
    for (const leak of ["the § 385 question", "under Section 385", "the 7701(e)(4) test"]) {
      const g = guardAnswer(leak, "ext-named");
      expect(g.hits).toContain("risk_legal");
    }
  });
});

describe("compartment guard — tier semantics (not a blanket mask)", () => {
  it("risk_legal PASSES at privileged (Slater's remit) but masks at ext-named/ext-generic", () => {
    const text = "The §385 and FEOC analysis is core to the structure.";
    expect(guardAnswer(text, "privileged").clean).toBe(true); // visible to Slater
    expect(guardAnswer(text, "ext-named").hits).toContain("risk_legal");
    expect(guardAnswer(text, "ext-generic").hits).toContain("risk_legal");
  });

  it("tribe PASSES at privileged/ext-named but masks at ext-generic", () => {
    const text = "The Chickasaw Nation relationship matters here.";
    expect(guardAnswer(text, "privileged").clean).toBe(true);
    expect(guardAnswer(text, "ext-named").clean).toBe(true);
    expect(guardAnswer(text, "ext-generic").hits).toContain("tribe");
  });

  it("the tier ladder is a strict superset chain", () => {
    const p = new Set(bannedClasses("privileged"));
    const en = new Set(bannedClasses("ext-named"));
    const eg = new Set(bannedClasses("ext-generic"));
    for (const c of p) expect(en.has(c)).toBe(true);
    for (const c of en) expect(eg.has(c)).toBe(true);
    expect(en.size).toBeGreaterThan(p.size);
    expect(eg.size).toBeGreaterThan(en.size);
  });
});

describe("compartment guard — fail-closed contract", () => {
  it("unknown tier → blocked refusal, raw text never returned", () => {
    const secret = "Frank owns 51% and the raise is $700,000.";
    const g = guardAnswer(secret, "partner-plus");
    expect(g.blocked).toBe(true);
    expect(g.clean).toBe(false);
    expect(g.masked).not.toContain("51%");
    expect(g.masked).not.toContain("700,000");
  });

  it("internal tier → straight passthrough (operator, unscoped)", () => {
    const text = "Frank owns 51% per the cap table; raise is $700,000.";
    const g = guardAnswer(text, "internal");
    expect(g.clean).toBe(true);
    expect(g.masked).toBe(text);
    expect(g.hits).toEqual([]);
  });

  it("empty / null-ish input is handled, never throws", () => {
    expect(guardAnswer("", "privileged").clean).toBe(true);
    expect(guardAnswer(undefined as unknown as string, "privileged").masked).toBe("");
  });
});

describe("compartment guard — effectiveTier floor", () => {
  it("a mis-enrolled internal chat is forced up to the privileged floor", () => {
    expect(effectiveTier("internal", "privileged")).toBe("privileged");
  });
  it("a partner's own stricter tier only tightens further", () => {
    expect(effectiveTier("ext-generic", "privileged")).toBe("ext-generic");
    expect(effectiveTier("ext-named", "privileged")).toBe("ext-named");
  });
  it("privileged at the privileged floor stays privileged", () => {
    expect(effectiveTier("privileged", "privileged")).toBe("privileged");
  });
});

describe("compartment guard — helpers", () => {
  it("isDealTier accepts the four tiers and rejects others", () => {
    for (const t of ["internal", "privileged", "ext-named", "ext-generic"] as DealTier[]) {
      expect(isDealTier(t)).toBe(true);
    }
    expect(isDealTier("partner")).toBe(false);
    expect(isDealTier(undefined)).toBe(false);
  });
  it("GUARD_CLASS_IDS covers exactly the implemented classes", () => {
    expect(new Set(GUARD_CLASS_IDS)).toEqual(
      new Set(["names", "cap", "econ", "risk_legal", "tribe"])
    );
  });
});

describe("principal-brand normalization (Alex/Craig → Adinkra Labs)", () => {
  it("rewrites each principal to the brand", () => {
    expect(normalizeBrand("Alex owns the HoldCo.")).toBe("Adinkra Labs owns the HoldCo.");
    expect(normalizeBrand("Talk to Craig about it.")).toBe("Talk to Adinkra Labs about it.");
    expect(normalizeBrand("Decided by Alex Peri.")).toBe("Decided by Adinkra Labs.");
  });
  it("collapses both principals named together into one brand", () => {
    expect(normalizeBrand("Alex and Craig control it.")).toBe("Adinkra Labs control it.");
  });
  it("never leaks a principal name in any combination", () => {
    for (const s of [
      "Alex", "Craig", "Alex Peri", "Craig Ellins",
      "Alex & Craig", "Alex/Craig", "Alex, Craig",
    ]) {
      expect(normalizeBrand(s)).not.toMatch(/\bAlex\b|\bCraig\b/i);
    }
  });
  it("leaves unrelated text untouched", () => {
    expect(normalizeBrand("The §48E credit is 40%.")).toBe("The §48E credit is 40%.");
  });
});
