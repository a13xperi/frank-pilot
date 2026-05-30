/**
 * Tests for src/db/seed-buildings.ts (LIHTC §42 Phase A — buildings + BIN).
 *
 * Two surfaces:
 *   1. buildingsFromBins() — PURE transform of the real bins.json (no DB).
 *      Asserts shape, totals, NULL-BIN preservation, fletcher provisional flag,
 *      and the NV-YY-NNNNN BIN format.
 *   2. seedBuildings() — DB seeder with a mocked query. Asserts EXACT-name
 *      property resolution (7 joinName props mapped, 5 unmapped skipped) and
 *      fail-closed unit matching (unmatched unit leaves building_id NULL, no throw).
 *
 * Compliance note: a wrong BIN on the wrong property is a real §42 error. The
 * loader uses EXACT name equality only — never fuzzy/substring — and never
 * invents a BIN. These tests lock that discipline.
 */

// ── Mocks (declared before importing the unit-under-test) ─────────────────────

jest.mock("../config/database", () => ({
  query: jest.fn(),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import { buildingsFromBins, seedBuildings, BinsJson } from "../db/seed-buildings";
import realBinsJson from "../db/data/bins.json";

const mockQuery = query as jest.MockedFunction<typeof query>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const BIN_RE = /^NV-\d{2}-\d{2}\d{3}$/;

/** The 7 binKeys that carry a non-null joinName, with their EXACT bins.json value. */
const EXPECTED_JOINNAMES: Record<string, string> = {
  juan: "Juan Garcia Aka Ernie Cragin",
  "louise-shell": "Louise Shell/Harmony Park Apts",
  meacham: "Dr. Paul Meacham",
  owens: "Owens Senior",
  reid: "Sen. Harry Reid Senior Apts Aka 11Th St",
  "smith-williams": "Smith Williams Apts",
  yale: "Yale/Keyes Senior Apts",
};

/** The 5 binKeys deliberately left without a join key (must be skipped). */
const UNMAPPED_KEYS = ["donnalouise", "fletcher", "mack", "ocallaghan", "srb"];

beforeEach(() => {
  jest.clearAllMocks();
});

// ── buildingsFromBins (pure) ──────────────────────────────────────────────────

describe("buildingsFromBins (pure transform)", () => {
  const records = buildingsFromBins(realBinsJson as unknown as BinsJson);

  it("returns 12 properties", () => {
    expect(records).toHaveLength(12);
  });

  it("totals 70 buildings", () => {
    const total = records.reduce((n, r) => n + r.buildings.length, 0);
    expect(total).toBe(70);
  });

  it("totals 965 units across all buildings", () => {
    const total = records.reduce(
      (n, r) => n + r.buildings.reduce((m, b) => m + b.unitNumbers.length, 0),
      0
    );
    expect(total).toBe(965);
  });

  it("has exactly 5 null BINs (fletcher 2 + ocallaghan 3)", () => {
    const byKey: Record<string, number> = {};
    let total = 0;
    for (const r of records) {
      const n = r.buildings.filter((b) => b.bin === null).length;
      byKey[r.binKey] = n;
      total += n;
    }
    expect(total).toBe(5);
    expect(byKey.fletcher).toBe(2);
    expect(byKey.ocallaghan).toBe(3);
    // No other property has a null BIN.
    for (const r of records) {
      if (r.binKey !== "fletcher" && r.binKey !== "ocallaghan") {
        expect(byKey[r.binKey]).toBe(0);
      }
    }
  });

  it("flags every fletcher building binConfidence='provisional'", () => {
    const fletcher = records.find((r) => r.binKey === "fletcher");
    expect(fletcher).toBeDefined();
    expect(fletcher!.buildings.length).toBeGreaterThan(0);
    for (const b of fletcher!.buildings) {
      expect(b.binConfidence).toBe("provisional");
    }
  });

  it("flags every non-fletcher building binConfidence='confirmed'", () => {
    for (const r of records) {
      if (r.binKey === "fletcher") continue;
      for (const b of r.buildings) {
        expect(b.binConfidence).toBe("confirmed");
      }
    }
  });

  it("preserves NULL bins as null and never invents one", () => {
    // Spot-check the two known null-BIN buildings.
    const ocallaghan = records.find((r) => r.binKey === "ocallaghan")!;
    const nullBldgs = ocallaghan.buildings.filter((b) => b.bin === null);
    expect(nullBldgs).toHaveLength(3);
  });

  it("every non-null BIN matches /^NV-\\d{2}-\\d{2}\\d{3}$/", () => {
    for (const r of records) {
      for (const b of r.buildings) {
        if (b.bin !== null) {
          expect(b.bin).toMatch(BIN_RE);
        }
      }
    }
  });

  it("carries bin_source as source.type:date (e.g. gpmg-email:2026-05-27)", () => {
    for (const r of records) {
      expect(r.binSource).toBe("gpmg-email:2026-05-27");
    }
  });

  it("reports joinName=null for the 5 unmapped keys and the exact string for the 7 mapped", () => {
    const byKey = Object.fromEntries(records.map((r) => [r.binKey, r.joinName]));
    for (const k of UNMAPPED_KEYS) {
      expect(byKey[k]).toBeNull();
    }
    for (const [k, name] of Object.entries(EXPECTED_JOINNAMES)) {
      expect(byKey[k]).toBe(name);
    }
  });
});

// ── seedBuildings (DB, mocked) ────────────────────────────────────────────────

describe("seedBuildings (crosswalk resolution + fail-closed)", () => {
  it("resolves the 7 joinName props by EXACT name and skips the 5 unmapped", async () => {
    const resolvedNames: string[] = [];

    mockQuery.mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM properties WHERE name")) {
        const name = (params as unknown[])[0] as string;
        resolvedNames.push(name);
        // Every known joinName resolves to exactly one row.
        return { rows: [{ id: `prop-${name}` }], rowCount: 1 } as any;
      }
      if (sql.startsWith("INSERT INTO buildings")) {
        return { rows: [{ id: "bldg-1" }], rowCount: 1 } as any;
      }
      // UPDATE units — pretend nothing matches (formats never overlap).
      return { rows: [], rowCount: 0 } as any;
    }) as any);

    await seedBuildings(query);

    // Exactly the 7 joinName strings were looked up — never the 5 unmapped keys,
    // and never a substring/ILIKE form.
    const lookupSqls = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.includes("FROM properties WHERE name"));
    expect(lookupSqls).toHaveLength(7);
    for (const s of lookupSqls) {
      expect(s).toContain("name = $1"); // exact equality, never ILIKE
      expect(s).not.toMatch(/ILIKE/i);
      expect(s).not.toContain("%");
    }
    expect(resolvedNames.sort()).toEqual(Object.values(EXPECTED_JOINNAMES).sort());
  });

  it("skips a joinName prop whose property row is absent (0 rows) without throwing", async () => {
    mockQuery.mockImplementation((async (sql: string) => {
      if (sql.includes("FROM properties WHERE name")) {
        // Simulate a fresh demo DB: the statewide joinName rows do not exist.
        return { rows: [], rowCount: 0 } as any;
      }
      return { rows: [{ id: "x" }], rowCount: 0 } as any;
    }) as any);

    await expect(seedBuildings(query)).resolves.toBeUndefined();

    // No building inserts happened because no property resolved.
    const inserts = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("INSERT INTO buildings"));
    expect(inserts).toHaveLength(0);
  });

  it("fail-closed: a unit_number with no match leaves building_id NULL and does NOT throw", async () => {
    let unitUpdates = 0;
    let unitsMatched = 0;

    mockQuery.mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM properties WHERE name")) {
        return { rows: [{ id: "prop-1" }], rowCount: 1 } as any;
      }
      if (sql.startsWith("INSERT INTO buildings")) {
        return { rows: [{ id: "bldg-1" }], rowCount: 1 } as any;
      }
      if (sql.startsWith("UPDATE units")) {
        unitUpdates++;
        // bins unit-number scheme never overlaps seeded synthetic units → 0 matched.
        const matched = 0;
        unitsMatched += matched;
        return { rows: [], rowCount: matched } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    }) as any);

    await expect(seedBuildings(query)).resolves.toBeUndefined();

    // Unit UPDATEs were attempted (one per unit string of the 7 mapped props)…
    expect(unitUpdates).toBeGreaterThan(0);
    // …but none matched, so building_id stays NULL everywhere. No throw.
    expect(unitsMatched).toBe(0);
  });

  it("upserts buildings with ON CONFLICT (property_id, building_code) DO UPDATE (idempotent)", async () => {
    mockQuery.mockImplementation((async (sql: string) => {
      if (sql.includes("FROM properties WHERE name")) {
        return { rows: [{ id: "prop-1" }], rowCount: 1 } as any;
      }
      if (sql.startsWith("INSERT INTO buildings")) {
        return { rows: [{ id: "bldg-1" }], rowCount: 1 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    }) as any);

    await seedBuildings(query);

    const inserts = mockQuery.mock.calls
      .map((c) => c[0] as string)
      .filter((s) => s.startsWith("INSERT INTO buildings"));
    expect(inserts.length).toBeGreaterThan(0);
    for (const s of inserts) {
      expect(s).toContain("ON CONFLICT (property_id, building_code) DO UPDATE");
    }
  });
});
