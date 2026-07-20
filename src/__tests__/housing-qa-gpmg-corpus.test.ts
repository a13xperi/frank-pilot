/**
 * Shape guard for the GPM property corpus
 * (docs/intel/gpmglv-properties-extracted.json → getGpmgProperties()).
 *
 * get_property_details resolves caller-spoken names against THIS pool and
 * speaks its amenities/address/type directly on the call, so a corpus
 * re-scrape that drops amenities, loses a community, or breaks the
 * senior/family typing silently degrades Frank ("no exact address" deflection
 * comes back). Every record must stay fully speakable.
 */
import { getGpmgProperties } from "../modules/housing-qa/data";

describe("GPM corpus (getGpmgProperties)", () => {
  const props = getGpmgProperties();

  it("carries all 17 GPM communities", () => {
    expect(props).toHaveLength(17);
  });

  it("every record is speakable: name, slug id, address, and non-empty amenities", () => {
    for (const p of props) {
      expect(p.name).toBeTruthy();
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(p.address).toBeTruthy();
      expect(Array.isArray(p.amenities)).toBe(true);
      expect((p.amenities as string[]).length).toBeGreaterThan(0);
    }
  });

  it("every record has a known community type (drives the senior flag + spoken label)", () => {
    for (const p of props) {
      expect(["senior", "family", "mixed_use"]).toContain(p.type);
    }
  });

  it("keeps the near-duplicate sibling pairs the matcher must disambiguate", () => {
    const names = props.map((p) => p.name ?? "");
    expect(names).toContain("Donna Louise Apartments");
    expect(names).toContain("Donna Louise 2 Apartments");
    expect(names).toContain("Ethel Mae Fletcher Apartments");
    expect(names).toContain("Ethel Mae Robinson Senior Apartments");
  });
});
