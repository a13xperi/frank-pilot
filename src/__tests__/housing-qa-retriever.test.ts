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
import { buildContext } from "../modules/housing-qa/retriever";
import { getHousingIndex } from "../modules/housing-qa/data";

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
    const ctx = buildContext("How much is the application fee and is it refundable?");
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
    const ctx = buildContext("What senior housing is available in Henderson?");
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
    const ctx = buildContext("What's the monthly rent at Silver Pines Apts?");
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
    const ctx = buildContext("Tell me about Moonbeam Towers");
    expect(ctx.routing).toBe("process");
    expect(ctx.propertyMode).toBe("none");
    expect(ctx.properties).toHaveLength(0);
    expect(ctx.notes.join(" ")).toMatch(/NOT in the statewide HUD-LIHTC or available-now data/i);
    expect(ctx.notes.join(" ")).toMatch(/Moonbeam Towers/);
  });

  it("(5) AMI/eligibility question → FAQ section, no personal ruling, no property objects", () => {
    const ctx = buildContext("I make $40,000 a year — do I qualify?");
    expect(ctx.routing).toBe("process");
    expect(ctx.propertyMode).toBe("none");
    expect(ctx.properties).toHaveLength(0);
    expect(ctx.faqSections.map((f) => f.id)).toContain("who-its-for");
  });

  it("emitted full-property objects never expose internal-only fields", () => {
    const ctx = buildContext("Tell me about Silver Pines Apts");
    const prop = ctx.properties[0] as Record<string, unknown>;
    expect(prop).not.toHaveProperty("_lat");
    expect(prop).not.toHaveProperty("_lng");
    expect(prop).not.toHaveProperty("_aka");
    // provenance _source is intentionally retained
    expect(prop).toHaveProperty("_source");
  });
});
