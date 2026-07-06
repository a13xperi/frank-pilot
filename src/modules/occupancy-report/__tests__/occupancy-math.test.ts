import { summarizeOccupancy } from "../occupancy-math";

describe("summarizeOccupancy (Form 8823 occupancy math)", () => {
  it("computes vacant units and percentage from counts", () => {
    expect(summarizeOccupancy(100, 87)).toEqual({
      totalUnits: 100,
      occupiedUnits: 87,
      vacantUnits: 13,
      occupancyPct: 87,
    });
  });

  it("rounds the percentage to 2 decimals", () => {
    expect(summarizeOccupancy(3, 2).occupancyPct).toBe(66.67);
  });

  it("clamps occupied to total so occupancy never exceeds 100%", () => {
    const s = summarizeOccupancy(10, 12);
    expect(s.occupiedUnits).toBe(10);
    expect(s.vacantUnits).toBe(0);
    expect(s.occupancyPct).toBe(100);
  });

  it("handles a zero-unit property without dividing by zero", () => {
    expect(summarizeOccupancy(0, 0)).toEqual({
      totalUnits: 0,
      occupiedUnits: 0,
      vacantUnits: 0,
      occupancyPct: 0,
    });
  });

  it("floors fractional inputs defensively", () => {
    const s = summarizeOccupancy(10.9, 5.9);
    expect(s.totalUnits).toBe(10);
    expect(s.occupiedUnits).toBe(5);
  });
});
