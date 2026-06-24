import { buildUnitPlan } from "../db/onboard-property";

const BASE = { name: "X", address_line1: "x", city: "y", zip: "z", unit_count: 48 };

describe("buildUnitPlan", () => {
  it("generates per-tier units from _ami_breakdown (Donna Louise 2)", () => {
    const plan = buildUnitPlan({
      ...BASE,
      name: "Donna Louise Apartments 2",
      unit_mix: { "1BR": 30, "2BR": 18 },
      rent_schedule: {
        "1BR_45AMI": 890, "1BR_40AMI": 791,
        "2BR_45AMI": 1068, "2BR_40AMI": 950, "2BR_market": 1634,
      },
      _ami_breakdown: {
        "1BR_45AMI": { units: 28, income_cap: 33255, rent: 890 },
        "1BR_40AMI": { units: 2, income_cap: 29560, rent: 791 },
        "2BR_45AMI": { units: 10, income_cap: 37980, rent: 1068 },
        "2BR_40AMI": { units: 2, income_cap: 33760, rent: 950 },
        "2BR_market": { units: 6, income_cap: null, rent: 1634 },
      },
    } as any);

    expect(plan).toHaveLength(48);
    const at = (r: number) => plan.filter((u) => u.monthly_rent === r).length;
    expect(at(890)).toBe(28);
    expect(at(791)).toBe(2);
    expect(at(1068)).toBe(10);
    expect(at(950)).toBe(2);
    expect(at(1634)).toBe(6);

    // 1BR numbered contiguously A-101..A-130 across both tiers; 2BR B-201..B-218.
    const ones = plan.filter((u) => u.bedrooms === 1).map((u) => u.unit_number);
    expect(new Set(ones).size).toBe(30);
    expect(ones).toContain("A-101");
    expect(ones).toContain("A-130");
    const twos = plan.filter((u) => u.bedrooms === 2).map((u) => u.unit_number);
    expect(new Set(twos).size).toBe(18);
    expect(twos).toContain("B-201");
    expect(twos).toContain("B-218");

    // ami_designation honors the CHECK: market => 'market', affordable 40/45 => null.
    expect(plan.filter((u) => u.ami_designation === "market")).toHaveLength(6);
    expect(plan.filter((u) => u.monthly_rent === 1634).every((u) => u.ami_designation === "market")).toBe(true);
    expect(plan.filter((u) => u.monthly_rent === 890).every((u) => u.ami_designation === null)).toBe(true);
    expect(plan.every((u) => ["30", "50", "60", "market", null].includes(u.ami_designation))).toBe(true);
  });

  it("falls back to unit_mix at the first matching rent tier when no _ami_breakdown", () => {
    const plan = buildUnitPlan({
      ...BASE,
      unit_count: 30,
      unit_mix: { "1BR": 30 },
      rent_schedule: { "1BR_45AMI": 890, "1BR_40AMI": 791 },
    } as any);
    expect(plan).toHaveLength(30);
    expect(plan.every((u) => u.monthly_rent === 890)).toBe(true); // first matching tier
    expect(plan.every((u) => u.ami_designation === null)).toBe(true);
  });

  it("throws when _ami_breakdown does not reconcile to unit_mix", () => {
    expect(() =>
      buildUnitPlan({
        ...BASE,
        unit_count: 30,
        unit_mix: { "1BR": 30 },
        _ami_breakdown: { "1BR_45AMI": { units: 25, rent: 890 } }, // 25 != 30
      } as any)
    ).toThrow(/reconcile/);
  });
});
