/**
 * housing-qa-tenant-faq.test.ts — tenant FAQ corpus + retrieval tests.
 *
 * Two contracts:
 *
 * 1. DATASET INTEGRITY — locks the output of scripts/build-tenant-faq.mjs:
 *    full #1–500 coverage, sanitization held (no dollar figures, no
 *    year-pinned 202x dates, no find/replace corruption residue, and nothing
 *    contradicting the locked $35.95 always-on application fee).
 *
 * 2. RETRIEVAL — matchTenantFaq surfaces the right entries (full text) for
 *    representative applicant questions, respects the cap, and FAILS SOFT
 *    (missing/corrupt corpus → [] — never a throw, never a 500).
 *
 * Pure data/retrieval tests — NO model call.
 */
import fs from "fs";
import path from "path";
import {
  getTenantFaqEntries,
  matchTenantFaq,
  _resetTenantFaq,
  TenantFaqEntry,
} from "../modules/housing-qa/tenant-faq";

const CORPUS_PATH = path.resolve(
  __dirname,
  "..",
  "db",
  "data",
  "tenant-faq.json"
);

describe("tenant-faq corpus — dataset integrity (parser output lock)", () => {
  const raw = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8")) as {
    entryCount: number;
    entries: TenantFaqEntry[];
  };
  const entries = raw.entries;

  it("loads with a consistent entry count", () => {
    expect(Array.isArray(entries)).toBe(true);
    expect(raw.entryCount).toBe(entries.length);
    expect(entries.length).toBe(190);
  });

  it("ids are unique and well-formed", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^tfaq-\d{3}(-\d{3})?$/);
    }
  });

  it("source numbers cover exactly #1–500 with no overlap", () => {
    const covered = new Array<boolean>(501).fill(false);
    for (const e of entries) {
      const { from, to } = e.sourceNumbers;
      expect(from).toBeGreaterThanOrEqual(1);
      expect(to).toBeLessThanOrEqual(500);
      expect(to).toBeGreaterThanOrEqual(from);
      for (let n = from; n <= to; n++) {
        expect(covered[n]).toBe(false); // no overlap
        covered[n] = true;
      }
    }
    for (let n = 1; n <= 500; n++) {
      expect(covered[n]).toBe(true); // no gap
    }
  });

  it("sanitization held: no corruption residue, no $ figures, no 202x dates", () => {
    for (const e of entries) {
      const text = `${e.question}\n${e.answer}`;
      // find/replace corruption ("MTSP"/"Tenant Selection Plan" damage)
      expect(text).not.toMatch(/screening process/i);
      expect(text).not.toMatch(/MTENANT/);
      // grounding rules: no dollar figures, no year-pinned data
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toMatch(/\b202\d\b/);
    }
  });

  it("the application-fee entry never contradicts the locked $35.95 fact", () => {
    const fee = entries.find((e) => e.id === "tfaq-011");
    expect(fee).toBeDefined();
    expect(fee!.question).toMatch(/application fee/i);
    // No dollar figure of any kind — the model must take the fee from the
    // always-on facts block, never from the FAQ.
    expect(fee!.answer).not.toMatch(/\$/);
    expect(fee!.answer).not.toMatch(/25|50/);
    expect(fee!.answer).toMatch(/platform fee fact/i);
  });

  it("every question ends with '?' and every answer is non-empty", () => {
    for (const e of entries) {
      expect(e.question.endsWith("?")).toBe(true);
      expect(e.answer.length).toBeGreaterThanOrEqual(4); // shortest: "Yes."
      expect(e.label).toMatch(/^#\d+(–\d+)?$/);
      expect(e.section.length).toBeGreaterThan(0);
      expect(e.sectionTitle.length).toBeGreaterThan(0);
    }
  });
});

describe("tenant-faq retrieval — matchTenantFaq", () => {
  beforeAll(() => _resetTenantFaq());
  afterAll(() => _resetTenantFaq());

  const idsFor = (q: string, cap?: number) =>
    matchTenantFaq(q, cap).map((m) => m.id);

  it("loads the corpus through the module loader", () => {
    expect(getTenantFaqEntries().length).toBe(190);
  });

  it("matches representative applicant questions to the right entries", () => {
    expect(idsFor("Do food stamps count as income?")).toContain("tfaq-063");
    expect(idsFor("Can I ask for a live-in aide?")).toContain("tfaq-118-120");
    expect(
      idsFor("What if everyone in my household is a full-time student?")
    ).toContain("tfaq-090");
    expect(idsFor("Do I report overtime, tips, bonuses or commissions?")).toContain(
      "tfaq-043-046"
    );
    expect(idsFor("Is an assistance animal the same as a pet?")).toContain(
      "tfaq-126-128"
    );
  });

  it("handles natural phrasings that differ from the corpus wording", () => {
    // Grouped corpus questions are slash-separated ("overtime / tips / …");
    // users ask with commas, "and", or entirely different words. These lock
    // the token-overlap behavior Fuse couldn't deliver.
    expect(idsFor("Can I pay my deposit in installments?")).toContain(
      "tfaq-415-417"
    );
    expect(idsFor("Do you accept Section 8 vouchers?")).toContain(
      "tfaq-421-426"
    );
    expect(idsFor("What happens if I miss a call from the property?")).toContain(
      "tfaq-243-247"
    );
    expect(idsFor("Can I appeal if my application is denied?")).toContain(
      "tfaq-450-455"
    );
    expect(idsFor("Are pets allowed?")).toContain("tfaq-494");
  });

  it("respects the cap and returns full text with citation labels", () => {
    const matches = matchTenantFaq("What income do I have to report?", 4);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(4);
    for (const m of matches) {
      expect(m.question.length).toBeGreaterThan(0);
      expect(m.answer.length).toBeGreaterThan(0); // FULL text, not a reference
      expect(m.label).toMatch(/^#\d+(–\d+)?$/);
      expect(m.sectionTitle.length).toBeGreaterThan(0);
    }
    expect(matchTenantFaq("What income do I have to report?", 2).length)
      .toBeLessThanOrEqual(2);
  });

  it("returns [] for blank questions and nonsense without throwing", () => {
    expect(matchTenantFaq("")).toEqual([]);
    expect(matchTenantFaq("   ")).toEqual([]);
    expect(Array.isArray(matchTenantFaq("zzzzqqqq xyzzy plugh"))).toBe(true);
  });

  it("fails soft when the corpus file is missing/corrupt (never throws)", () => {
    _resetTenantFaq();
    const spy = jest.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT (simulated)");
    });
    try {
      expect(getTenantFaqEntries()).toEqual([]);
      expect(matchTenantFaq("Do food stamps count as income?")).toEqual([]);
    } finally {
      spy.mockRestore();
      _resetTenantFaq();
    }
    // and recovers once the file is readable again
    expect(getTenantFaqEntries().length).toBe(190);
  });
});
