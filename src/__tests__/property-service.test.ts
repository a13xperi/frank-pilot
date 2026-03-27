/**
 * Tests for src/modules/properties/service.ts
 *
 * Key invariants:
 *   - list() returns all properties ordered by name
 *   - getById() returns null on miss
 *   - create() writes audit log; returns mapped record
 *   - update() throws when property not found; throws when no fields provided
 *   - update() builds dynamic SET clause — only provided fields are included
 *   - addressLine1/city/state/zip are NOT updatable (not in UpdatePropertyInput)
 */

import { PropertyService } from "../modules/properties/service";

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock("../config/database", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

const ACTOR_ID = "user-am-001";
const ACTOR_ROLE = "asset_manager";
const PROP_ID = "prop-001";

const sampleRow = {
  id: PROP_ID,
  name: "Desert Oasis Apartments",
  address_line1: "1234 Las Vegas Blvd S",
  address_line2: null,
  city: "Las Vegas",
  state: "NV",
  zip: "89109",
  unit_count: 120,
  ami_area: "Las Vegas-Henderson-Paradise, NV MSA",
  onesite_property_id: "os-001",
  loft_property_id: null,
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
};

// ── list() ─────────────────────────────────────────────────────────────────

describe("PropertyService.list()", () => {
  let service: PropertyService;
  beforeEach(() => { jest.clearAllMocks(); service = new PropertyService(); });

  it("returns empty array when no properties exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const result = await service.list();
    expect(result).toEqual([]);
  });

  it("returns mapped PropertyRecord array", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(PROP_ID);
    expect(result[0].name).toBe("Desert Oasis Apartments");
    expect(result[0].addressLine1).toBe("1234 Las Vegas Blvd S");
    expect(result[0].unitCount).toBe(120);
    expect(result[0].onesitePropertyId).toBe("os-001");
    expect(result[0].loftPropertyId).toBeNull();
  });

  it("queries ORDER BY name", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    await service.list();
    expect(mockQuery.mock.calls[0]![0]).toMatch(/ORDER BY name/i);
  });
});

// ── getById() ─────────────────────────────────────────────────────────────

describe("PropertyService.getById()", () => {
  let service: PropertyService;
  beforeEach(() => { jest.clearAllMocks(); service = new PropertyService(); });

  it("returns null when property not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);
    const result = await service.getById("nonexistent");
    expect(result).toBeNull();
  });

  it("returns mapped record when found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);
    const result = await service.getById(PROP_ID);

    expect(result).not.toBeNull();
    expect(result!.city).toBe("Las Vegas");
    expect(result!.state).toBe("NV");
    expect(result!.zip).toBe("89109");
    expect(result!.amiArea).toBe("Las Vegas-Henderson-Paradise, NV MSA");
  });

  it("queries by propertyId", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);
    await service.getById(PROP_ID);
    expect(mockQuery.mock.calls[0]![1]).toEqual([PROP_ID]);
  });
});

// ── create() ──────────────────────────────────────────────────────────────

describe("PropertyService.create()", () => {
  let service: PropertyService;
  beforeEach(() => { jest.clearAllMocks(); service = new PropertyService(); });

  it("inserts property and returns mapped record", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    const result = await service.create(
      {
        name: "Desert Oasis",
        addressLine1: "1234 Las Vegas Blvd S",
        city: "Las Vegas",
        state: "NV",
        zip: "89109",
        unitCount: 120,
        amiArea: "Las Vegas-Henderson-Paradise, NV MSA",
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(result.id).toBe(PROP_ID);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![0]).toMatch(/INSERT INTO properties/i);
  });

  it("defaults optional fields to null in INSERT params", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.create(
      {
        name: "Test",
        addressLine1: "1 Main St",
        city: "Reno",
        state: "NV",
        zip: "89501",
        unitCount: 50,
        amiArea: "Reno MSA",
        // no addressLine2, onesitePropertyId, loftPropertyId
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    const params = mockQuery.mock.calls[0]![1] as any[];
    expect(params[2]).toBeNull(); // addressLine2
    expect(params[8]).toBeNull(); // onesitePropertyId
    expect(params[9]).toBeNull(); // loftPropertyId
  });

  it("writes a property_created audit log", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.create(
      {
        name: "Test",
        addressLine1: "1 Main St",
        city: "Las Vegas",
        state: "NV",
        zip: "89101",
        unitCount: 40,
        amiArea: "Las Vegas MSA",
      },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "property_created",
        actorId: ACTOR_ID,
        actorRole: ACTOR_ROLE,
        resourceType: "property",
      })
    );
  });
});

// ── update() ──────────────────────────────────────────────────────────────

describe("PropertyService.update()", () => {
  let service: PropertyService;
  beforeEach(() => { jest.clearAllMocks(); service = new PropertyService(); });

  it("throws when no fields are provided", async () => {
    await expect(
      service.update(PROP_ID, {}, ACTOR_ID, ACTOR_ROLE)
    ).rejects.toThrow("No fields provided for update");

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("throws when property not found (UPDATE returns 0 rows)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      service.update("nonexistent", { name: "New Name" }, ACTOR_ID, ACTOR_ROLE)
    ).rejects.toThrow(/property not found/i);
  });

  it("only includes provided fields in SET clause", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.update(PROP_ID, { name: "New Name", unitCount: 150 }, ACTOR_ID, ACTOR_ROLE);

    const sql = mockQuery.mock.calls[0]![0] as string;
    // Check only the SET portion (before WHERE) to avoid false positives from RETURNING clause
    const setPart = sql.split(/WHERE/i)[0]!;
    expect(setPart).toMatch(/name = \$2/);
    expect(setPart).toMatch(/unit_count = \$3/);
    // Fields NOT provided should not appear in SET clause
    expect(setPart).not.toMatch(/ami_area/);
    expect(setPart).not.toMatch(/loft_property_id/);
  });

  it("returns the updated record", async () => {
    const updatedRow = { ...sampleRow, name: "Renamed Property", unit_count: 200 };
    mockQuery.mockResolvedValueOnce({ rows: [updatedRow] } as any);

    const result = await service.update(
      PROP_ID,
      { name: "Renamed Property", unitCount: 200 },
      ACTOR_ID,
      ACTOR_ROLE
    );

    expect(result.name).toBe("Renamed Property");
    expect(result.unitCount).toBe(200);
  });

  it("writes a property_updated audit log with changed fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [sampleRow] } as any);

    await service.update(PROP_ID, { amiArea: "New MSA" }, ACTOR_ID, ACTOR_ROLE);

    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "property_updated",
        resourceId: PROP_ID,
        details: expect.objectContaining({ changes: { amiArea: "New MSA" } }),
      })
    );
  });
});
