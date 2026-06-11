/**
 * housing-qa-retriever.test.ts — unit tests for the grounded retriever.
 *
 * Ports the 5 smoke cases proven on the Python tool (tools/housing-qa).
 * These are pure retrieval tests — NO model call — asserting on the assembled
 * CONTEXT payload shape (routing, propertyMode, properties, faqSections, notes).
 *
 * They lock the grounding contract: process Qs inject no property objects,
 * city+attribute Qs filter on both and cap at K=8, statewide-only named
 * properties refuse rent (rent.disclosed=false → no rent value), and an
 * unknown property name produces a refusal note with no invented data.
 */
import fs from "fs";
import path from "path";
import {
  buildContext,
  RETRIEVAL_POLICIES,
} from "../modules/housing-qa/retriever";
import { getHousingIndex } from "../modules/housing-qa/data";

// The applicant policy carries the ORIGINAL full grounding contract — the
// long-standing pins below now exercise it explicitly. The tenant policy is
// the public tenant-portal scope (tenantFaq-only) pinned further down.
const APPLICANT = RETRIEVAL_POLICIES.applicant_portal;
const TENANT = RETRIEVAL_POLICIES.tenant_public;

describe("housing-qa retriever — grounded context assembly", () => {
  it("builds the merged index (335 statewide + 17 GPMG)", () => {
    const idx = getHousingIndex();
    expect(idx.statewideCount).toBe(335);
    expect(idx.gpmgCount).toBe(17);
    // every GPMG record is either merged into a statewide record or appended.
    expect(idx.availableNowCount).toBeGreaterThan(0);
    expect(idx.availableNowCount).toBeLessThanOrEqual(17);
  });

  it("(1) process question (fee) → FAQ-only, no property objects", () => {
    const ctx = buildContext("How much is the application fee and is it refundable?", APPLICANT);
    expect(ctx.routing).toBe("process");
    expect(ctx.propertyMode).toBe("none");
    expect(ctx.properties).toHaveLength(0);
    expect(ctx.faqSections.map((f) => f.id)).toContain("fees");
    // always-on facts block is present so the agent can ground the answer.
    expect(ctx.facts.applicationFee.amount).toBe("$35.95");
    expect(ctx.facts.applicationFee.refundable).toBe(false);
    // truncation fields are compact-only — absent on process routes (#224).
    expect(ctx.totalMatching).toBeUndefined();
    expect(ctx.shown).toBeUndefined();
  });

  it("(2) 'senior housing in Henderson' → city+attribute filter, compact, capped at K=8", () => {
    const ctx = buildContext("What senior housing is available in Henderson?", APPLICANT);
    expect(ctx.routing).toBe("attribute");
    expect(ctx.propertyMode).toBe("compact");
    // capped
    expect(ctx.properties.length).toBeLessThanOrEqual(8);
    expect(ctx.properties.length).toBeGreaterThan(0);
    // #224: the TRUE total is surfaced as a structured field (19 senior records
    // in Henderson) alongside how many reached the model (8) — so the prompt can
    // make the model disclose "8 of 19" instead of implying the slice is all.
    expect(ctx.totalMatching).toBe(19);
    expect(ctx.shown).toBe(8);
    expect(ctx.shown).toBe(ctx.properties.length);
    expect(ctx.totalMatching!).toBeGreaterThan(ctx.shown!);
    // filtered by BOTH city (Henderson) and attribute (senior)
    for (const p of ctx.properties) {
      const cp = p as { city: string | null; type: string | null };
      expect(cp.city).toBe("Henderson");
      expect((cp.type || "").toLowerCase()).toContain("senior");
    }
    // compact shape — no full contact/rent object leaked
    expect(ctx.properties[0]).not.toHaveProperty("contact");
    expect(ctx.properties[0]).not.toHaveProperty("rent");
  });

  it("(3) named property rent → property matched, rent refused (rent.disclosed=false → no value)", () => {
    const ctx = buildContext("What's the monthly rent at Silver Pines Apts?", APPLICANT);
    expect(ctx.routing).toBe("named_property");
    expect(ctx.propertyMode).toBe("full");
    expect(ctx.properties).toHaveLength(1);
    const prop = ctx.properties[0] as {
      name: string;
      rent: { disclosed: boolean; text: string | null };
      contact: { phone: string | null };
    };
    expect(prop.name).toBe("Silver Pines Apts");
    // rent is NOT disclosed → no rent value, so the agent must refuse it.
    expect(prop.rent.disclosed).toBe(false);
    expect(prop.rent.text).toBeNull();
    // statewide-only → no invented contact info + a refusal note.
    expect(prop.contact.phone).toBeNull();
    expect(ctx.notes.join(" ")).toMatch(/statewide HUD-LIHTC dataset only/i);
  });

  it("(4) unknown property 'Moonbeam Towers' → no match, no invented data, refusal note", () => {
    const ctx = buildContext("Tell me about Moonbeam Towers", APPLICANT);
    expect(ctx.routing).toBe("process");
    expect(ctx.propertyMode).toBe("none");
    expect(ctx.properties).toHaveLength(0);
    expect(ctx.notes.join(" ")).toMatch(/NOT in the statewide HUD-LIHTC or available-now data/i);
    expect(ctx.notes.join(" ")).toMatch(/Moonbeam Towers/);
  });

  it("(5) AMI/eligibility question → FAQ section, no personal ruling, no property objects", () => {
    const ctx = buildContext("I make $40,000 a year — do I qualify?", APPLICANT);
    expect(ctx.routing).toBe("process");
    expect(ctx.propertyMode).toBe("none");
    expect(ctx.properties).toHaveLength(0);
    expect(ctx.faqSections.map((f) => f.id)).toContain("who-its-for");
  });

  it("emitted full-property objects never expose internal-only fields", () => {
    const ctx = buildContext("Tell me about Silver Pines Apts", APPLICANT);
    const prop = ctx.properties[0] as Record<string, unknown>;
    expect(prop).not.toHaveProperty("_lat");
    expect(prop).not.toHaveProperty("_lng");
    expect(prop).not.toHaveProperty("_aka");
    // provenance _source is intentionally retained
    expect(prop).toHaveProperty("_source");
  });
});

/**
 * AMI-tier provenance contract (issue #225).
 *
 * Investigation (2026-05-30, live prod probes) established that #225 is NOT a
 * grounding leak — the model provably refuses to invent AMI tiers for records
 * it wasn't given — and NOT a recoverable data gap: enrichment has converged
 * (scripts/enrich-ami-tiers.py fills 0 additional of the ~81 statewide records
 * that have no NHD-LIHD counterpart). Those nulls are legitimately
 * "AMI tier unknown in our sources."
 *
 * What remains is to LOCK the contract so the leak can never be *introduced* by
 * a future refactor. The single coercion point is load-time normalization
 * (`blankNormalized`: `amiTiers && amiTiers.length ? amiTiers : null`). The two
 * emit paths — `compact()` (city/attribute) and `stripInternal()` (named) —
 * must pass `amiTiers` through untouched, and an amiTier *filter* must never
 * surface a null-tier record (so the model is never handed an empty/ambiguous
 * tier to cite).
 */
describe("housing-qa retriever — AMI-tier provenance (#225)", () => {
  const idx = getHousingIndex();

  it("normalizes empty amiTiers to null — never a citable empty array []", () => {
    // The whole point: an empty `[]` would read as 'tiers known to be none',
    // a subtly different (and false) claim than `null` = 'not in our data'.
    const empties = idx.records.filter(
      (r) => Array.isArray(r.amiTiers) && r.amiTiers.length === 0
    );
    expect(empties).toHaveLength(0);

    // Every record is either null or a non-empty string[] — no third state.
    for (const r of idx.records) {
      expect(
        r.amiTiers === null ||
          (Array.isArray(r.amiTiers) && r.amiTiers.length > 0)
      ).toBe(true);
    }
  });

  it("the contract is exercised on real data — both null and populated records exist", () => {
    const nulls = idx.records.filter((r) => r.amiTiers === null);
    const populated = idx.records.filter(
      (r) => Array.isArray(r.amiTiers) && r.amiTiers.length > 0
    );
    // ~81 statewide records have no NHD-LIHD AMI source (legitimately null);
    // 254 are enriched. Soft bounds, not exact counts (data may grow).
    expect(nulls.length).toBeGreaterThan(0);
    expect(populated.length).toBeGreaterThan(100);
  });

  it("a named record with no AMI source emits amiTiers: null (never invented)", () => {
    // City Center Las Vegas is in the statewide set but has no matchable
    // NHD-LIHD tier — it must surface as null, not a fabricated percentage.
    const ctx = buildContext("Tell me about City Center Las Vegas", APPLICANT);
    expect(ctx.routing).toBe("named_property");
    const prop = ctx.properties[0] as { name: string | null; amiTiers: unknown };
    expect(prop.name).toBe("City Center Las Vegas");
    expect(prop.amiTiers).toBeNull();
  });

  it("a named record WITH an AMI source emits its real tiers (control)", () => {
    const ctx = buildContext("Tell me about Silver Pines Apts", APPLICANT);
    expect(ctx.routing).toBe("named_property");
    const prop = ctx.properties[0] as { amiTiers: string[] | null };
    expect(Array.isArray(prop.amiTiers)).toBe(true);
    expect(prop.amiTiers!.length).toBeGreaterThan(0);
  });

  it("an amiTier filter never surfaces a null-tier record", () => {
    // Filtering by a tier must only return records that actually carry it;
    // a null-tier record can never match (guards retriever.ts `r.amiTiers || []`).
    const ctx = buildContext("Show me 50% AMI housing in Las Vegas", APPLICANT);
    for (const p of ctx.properties) {
      const tiers = (p as { amiTiers: string[] | null }).amiTiers;
      expect(tiers).not.toBeNull();
      expect(Array.isArray(tiers)).toBe(true);
      expect(tiers!.length).toBeGreaterThan(0);
    }
  });

  it("the fallback snapshot mirrors the primary's amiTiers (no silent drift)", () => {
    // data.ts loads client-tenant/public/nv-housing-props.json and only falls
    // back to src/db/data/nv-housing-props.json when the primary is missing.
    // The two are committed in lock-step (same records, same order) so a missing
    // primary degrades to identical AMI data — NEVER to the all-null fallback the
    // file used to be (issue #225). This locks that promise: if someone re-runs
    // enrich-ami-tiers.py (which writes only the primary) without re-syncing the
    // fallback, this test fails loudly instead of letting the mirror rot.
    const root = path.resolve(__dirname, "..", "..");
    const primary = JSON.parse(
      fs.readFileSync(
        path.join(root, "client-tenant", "public", "nv-housing-props.json"),
        "utf-8"
      )
    ) as Array<{ name: string; amiTiers: string[] | null }>;
    const fallback = JSON.parse(
      fs.readFileSync(
        path.join(root, "src", "db", "data", "nv-housing-props.json"),
        "utf-8"
      )
    ) as Array<{ name: string; amiTiers: string[] | null }>;

    expect(fallback.length).toBe(primary.length);
    for (let i = 0; i < primary.length; i++) {
      // same record at the same index …
      expect(fallback[i].name).toBe(primary[i].name);
      // … carrying the same AMI tiers (null === [] treated as equal — both load
      // to null via blankNormalized, so the served grounding is identical).
      expect(fallback[i].amiTiers ?? []).toEqual(primary[i].amiTiers ?? []);
    }
  });
});

/**
 * Tenant FAQ injection contract — the 500-question corpus reaches the context
 * payload as FULL Q&A text on every branch, capped at 4 on process routes and
 * 2 when property objects are injected (property data stays dominant). The
 * sanitization itself is locked in housing-qa-tenant-faq.test.ts; here we lock
 * the wiring.
 */
describe("housing-qa retriever — tenantFaq context injection", () => {
  it("process question carries up to 4 tenant-FAQ entries with full text", () => {
    const ctx = buildContext("Do food stamps count as income?", APPLICANT);
    expect(ctx.routing).toBe("process");
    expect(ctx.tenantFaq.length).toBeGreaterThan(0);
    expect(ctx.tenantFaq.length).toBeLessThanOrEqual(4);
    expect(ctx.tenantFaq.map((m) => m.id)).toContain("tfaq-063");
    // full text — not a reference like faqSections
    expect(ctx.tenantFaq[0].answer.length).toBeGreaterThan(0);
  });

  it("named-property question caps tenant-FAQ entries at 2", () => {
    const ctx = buildContext("Are pets allowed at Silver Pines Apts?", APPLICANT);
    expect(ctx.routing).toBe("named_property");
    expect(ctx.tenantFaq.length).toBeLessThanOrEqual(2);
  });

  it("fee question: no tenant-FAQ entry undercuts the $35.95 always-on fact", () => {
    const ctx = buildContext("How much is the application fee and is it refundable?", APPLICANT);
    expect(ctx.facts.applicationFee.amount).toBe("$35.95");
    for (const m of ctx.tenantFaq) {
      expect(m.answer).not.toMatch(/\$\s?\d/); // no competing dollar figure
    }
  });
});

/**
 * Per-surface retrieval policy — the tenant-scope enforcement seam.
 *
 * The 2026-06 demo leak: the UNAUTHENTICATED tenant-portal widget asked
 * "test" got back a property card for "Test Property, Carson City" straight
 * from the statewide HUD-LIHTC dataset, plus internal pipeline language. The
 * tenant_public policy closes this in CODE: the property index is never
 * consulted (not even for classification), `_meta` and the echoed question
 * are omitted, and facts lose their internal provenance fields. These pins
 * assert on the SERIALIZED payload — what the model would actually see.
 */
describe("housing-qa retriever — tenant_public policy (data scoping)", () => {
  // Markers that must never appear in a tenant-surface payload. Bare "HUD" /
  // "LIHTC" are NOT markers — they are program names that legitimately occur
  // in approved tenantFaq answers; the DATASET name is the hyphenated form.
  const LEAK_MARKERS =
    /Test Property|Carson City|Silver Pines|HUD[\s-]LIHTC|GPMG|statewide|named_property|faq\.md|apply\.json/i;

  it("'test' (the demo-leak repro) → faq_only, zero property objects, no statewide markers", () => {
    const ctx = buildContext("test", TENANT);
    expect(ctx.routing).toBe("faq_only");
    expect(ctx.propertyMode).toBe("none");
    expect(ctx.properties).toHaveLength(0);
    expect(JSON.stringify(ctx)).not.toMatch(LEAK_MARKERS);
  });

  it("a named-property question injects NO property data and never echoes the name", () => {
    // On the applicant surface this exact question injects the full Silver
    // Pines record — the tenant surface must inject nothing and must not even
    // echo the property name (the question is not repeated in the payload).
    const ctx = buildContext("What's the monthly rent at Silver Pines Apts?", TENANT);
    expect(ctx.routing).toBe("faq_only");
    expect(ctx.properties).toHaveLength(0);
    expect(ctx.notes).toHaveLength(0); // no statewide-only refusal note either
    expect(JSON.stringify(ctx)).not.toMatch(LEAK_MARKERS);
  });

  it("city/attribute questions return zero statewide hits on the tenant surface", () => {
    for (const q of [
      "What senior housing is available in Henderson?",
      "Show me 50% AMI housing in Las Vegas",
      "What's available right now?",
    ]) {
      const ctx = buildContext(q, TENANT);
      expect(ctx.routing).toBe("faq_only");
      expect(ctx.properties).toHaveLength(0);
      expect(ctx.totalMatching).toBeUndefined();
      expect(ctx.shown).toBeUndefined();
    }
  });

  it("tenant payloads omit _meta (dataset names/counts) and the echoed question", () => {
    const ctx = buildContext("Do food stamps count as income?", TENANT);
    expect(ctx._meta).toBeUndefined();
    expect(ctx.question).toBeUndefined();
    // applicant control: both present there (the original contract).
    const appl = buildContext("Do food stamps count as income?", APPLICANT);
    expect(appl._meta).toBeDefined();
    expect(appl.question).toBe("Do food stamps count as income?");
  });

  it("tenant facts are provenance-free but keep the locked $35.95 fee", () => {
    const ctx = buildContext("How much is the application fee?", TENANT);
    expect(ctx.facts.applicationFee.amount).toBe("$35.95");
    expect(ctx.facts.applicationFee.refundable).toBe(false);
    expect(ctx.facts.rule120.days).toBe(120);
    // no internal `source` fields naming repo files (apply.json …)
    expect(JSON.stringify(ctx.facts)).not.toMatch(/apply\.json|"source"|"documentsSource"/);
  });

  it("faqSections (applicant pipeline references) are scoped out of the tenant surface", () => {
    const ctx = buildContext("How do I apply?", TENANT);
    expect(ctx.faqSections).toHaveLength(0);
  });

  it("the pinned grounded answers still retrieve on the tenant surface", () => {
    // SNAP / food stamps → Tenant FAQ #63
    const snap = buildContext("Do food stamps count as income?", TENANT);
    expect(snap.tenantFaq.map((m) => m.id)).toContain("tfaq-063");
    // live-in aide → Tenant FAQ #118–120
    const aide = buildContext("Can I ask for a live-in aide?", TENANT);
    expect(aide.tenantFaq.map((m) => m.id)).toContain("tfaq-118-120");
    // tenantFaq is the primary source here — cap is 4, full text included
    expect(snap.tenantFaq.length).toBeLessThanOrEqual(4);
    expect(snap.tenantFaq[0].answer.length).toBeGreaterThan(0);
  });

  it("the applicant surface still serves full statewide retrieval (control)", () => {
    // The same repro question on the applicant policy DOES consult the index —
    // proving the scoping is the policy, not a retriever-wide lobotomy.
    const ctx = buildContext("test", APPLICANT);
    expect(ctx.routing).not.toBe("faq_only");
    const henderson = buildContext("What senior housing is available in Henderson?", APPLICANT);
    expect(henderson.properties.length).toBeGreaterThan(0);
  });
});
