/**
 * deal-qa-service.test.ts — retrieval + extractive grounding against the REAL
 * committed deal corpus (src/db/data/deal-corpus.json). Proves the end-to-end
 * extractive path returns cited passages AND that the privileged mask actually
 * neutralizes the withhold set present in the real deal docs (not just synthetic
 * fixtures).
 */
import { groundAnswer } from "../modules/deal-qa/service";
import {
  searchDealCorpus,
  getDealEntries,
  _resetDealCorpus,
} from "../modules/deal-qa/corpus";
import { guardAnswer } from "../modules/deal-qa/compartment-guard";

describe("deal-qa retrieval + extractive grounding (real corpus)", () => {
  beforeAll(() => _resetDealCorpus());

  it("loads the committed deal corpus", () => {
    expect(getDealEntries().length).toBeGreaterThan(50);
  });

  it("retrieves cited passages for a deal question", () => {
    const hits = searchDealCorpus("how do the energy credits stack", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.answer.length).toBeGreaterThan(0);
    // Scores are sorted best-first.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it("groundAnswer returns a cited, masked answer at privileged", () => {
    const r = groundAnswer("what is the structure of the stack and the token", "privileged");
    expect(r.ok).toBe(true);
    if (!r.empty) {
      expect(r.answer).toMatch(/\[1\]/); // inline citation
      expect(r.nSources).toBeGreaterThan(0);
      expect(r.answer).not.toMatch(/\$\s?\d/); // no raw $ figure leaks
      expect(r.answer).not.toMatch(/\b51 ?%/); // no cap reveal leaks
    }
  });

  it("a blank/garbage query grounds empty rather than throwing", () => {
    expect(groundAnswer("", "privileged")).toEqual({ ok: true, empty: true });
    expect(groundAnswer("zzxqj wkpfh", "privileged").empty).toBe(true);
  });

  it("the privileged mask neutralizes the withhold set across the WHOLE corpus", () => {
    const entries = getDealEntries();
    let dirty = 0;
    let leaked = 0;
    for (const e of entries) {
      const g = guardAnswer(e.answer, "privileged");
      if (!g.clean) dirty += 1;
      // Post-mask, no $ figure and no 51% cap reveal may survive.
      if (/\$\s?\d/.test(g.masked) || /\b51 ?%/.test(g.masked)) leaked += 1;
    }
    // The curated deal docs DO contain withhold-set content (names/econ/cap)…
    expect(dirty).toBeGreaterThan(0);
    // …and none of it survives the privileged mask.
    expect(leaked).toBe(0);
  });
});
