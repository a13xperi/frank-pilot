/**
 * Tests for src/modules/properties/service.ts
 *
 * Coverage focus:
 *   - listing and lookup map DB rows into service records
 *   - create() persists defaults for optional fields and writes an audit log
 *   - update() validates input, updates only requested fields, and writes an audit log
 */

import { PropertyService } from "../modules/properties/service";

jest.mock("../config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock("../middleware/audit", () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { query } from "../config/database";
import { writeAuditLog } from "../middleware/audit";

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

const ACTOR_ID = "user-am-001";
const ACTOR_ROLE = "asset_manager";
const PROPERTY_ID = "prop-001";

function makePropertyRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: PROPERTY_ID,
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
    phone: null,
    email: null,
    property_manager: null,
    property_type: "family",
    lihtc_type: null,
    ami_set_aside: null,
    compliance_period_start: new Date("2026-01-01T00:00:00.000Z"),
    compliance_period_end: new Date("2036-01-01T00:00:00.000Z"),
    has_lura: false,
    has_mortgage: false,
    jurisdiction: null,
    unit_mix: { oneBedroom: 50, twoBedroom: 70 },
    rent_schedule: { oneBedroom: 1100, twoBedroom: 1350 },
    total_vacancy: 4,
    waiting_list_enabled: false,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-15T00:00:00.000Z"),
    ...overrides,
  };
}

describe("PropertyService", () => {
  let service: PropertyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PropertyService();
  });

  describe("list", () => {
    it("returns an empty array when no properties exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.list();

      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY name"),
        []
      );
    });

    it("maps database rows into property records", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makePropertyRow({
            property_type: "mixed_use",
            has_lura: true,
            waiting_list_enabled: true,
          }),
        ],
      } as any);

      const result = await service.list();

      expect(result).toEqual([
        expect.objectContaining({
          id: PROPERTY_ID,
          name: "Desert Oasis Apartments",
          addressLine1: "1234 Las Vegas Blvd S",
          propertyType: "mixed_use",
          compliancePeriodStart: "2026-01-01",
          compliancePeriodEnd: "2036-01-01",
          hasLura: true,
          waitingListEnabled: true,
          unitMix: { oneBedroom: 50, twoBedroom: 70 },
          rentSchedule: { oneBedroom: 1100, twoBedroom: 1350 },
        }),
      ]);
    });
  });

  describe("getById", () => {
    it("returns null when the property is not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      await expect(service.getById("missing-property")).resolves.toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1"),
        ["missing-property"]
      );
    });

    it("returns the mapped property when found", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makePropertyRow({ jurisdiction: "Clark County" })],
      } as any);

      const result = await service.getById(PROPERTY_ID);

      expect(result).toEqual(
        expect.objectContaining({
          id: PROPERTY_ID,
          city: "Las Vegas",
          state: "NV",
          jurisdiction: "Clark County",
        })
      );
    });
  });

  describe("create", () => {
    it("creates a property, returns the mapped record, and writes an audit log", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makePropertyRow({
            email: "leasing@desertoasis.org",
            property_manager: "Jordan Smith",
          }),
        ],
      } as any);

      const result = await service.create(
        {
          name: "Desert Oasis Apartments",
          addressLine1: "1234 Las Vegas Blvd S",
          city: "Las Vegas",
          state: "NV",
          zip: "89109",
          unitCount: 120,
          amiArea: "Las Vegas-Henderson-Paradise, NV MSA",
          email: "leasing@desertoasis.org",
          propertyManager: "Jordan Smith",
        },
        ACTOR_ID,
        ACTOR_ROLE
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO properties"),
        expect.any(Array)
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: PROPERTY_ID,
          email: "leasing@desertoasis.org",
          propertyManager: "Jordan Smith",
        })
      );
      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "property_created",
          actorId: ACTOR_ID,
          actorRole: ACTOR_ROLE,
          resourceType: "property",
          resourceId: PROPERTY_ID,
        })
      );
    });

    it("uses service defaults for optional and structured fields", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makePropertyRow()],
      } as any);

      await service.create(
        {
          name: "Desert Oasis Apartments",
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

      const params = mockQuery.mock.calls[0]?.[1] as unknown[];

      expect(params[2]).toBeNull();
      expect(params[8]).toBeNull();
      expect(params[9]).toBeNull();
      expect(params[13]).toBe("family");
      expect(params[18]).toBe(false);
      expect(params[19]).toBe(false);
      expect(params[21]).toBe("{}");
      expect(params[22]).toBe("{}");
      expect(params[23]).toBe(0);
      expect(params[24]).toBe(false);
    });
  });

  // ── Wedge #9 — rent range + AMI tier rollup ──────────────────────────────

  describe("listWithAvailability (rent range + amiTier)", () => {
    function makeAggregateRow(
      overrides: Partial<Record<string, unknown>> = {}
    ): Record<string, unknown> {
      // Mirrors the aggregate row shape produced by the joined SQL in
      // listWithAvailability: property columns + availability counts +
      // per-bedroom rent min/max.
      return {
        ...makePropertyRow({ ami_set_aside: "60% AMI" }),
        available_count: 7,
        leased_count: 2,
        total_units_actual: 10,
        studio_count: 1,
        br1_count: 2,
        br2_count: 3,
        br3_count: 1,
        studio_rent_min: 850,
        studio_rent_max: 850,
        br1_rent_min: 975,
        br1_rent_max: 1100,
        br2_rent_min: 1200,
        br2_rent_max: 1425,
        br3_rent_min: 1500,
        br3_rent_max: 1700,
        ...overrides,
      };
    }

    it("includes a per-bedroom rentRange and amiTier on each property", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeAggregateRow()] } as any);

      const result = await service.listWithAvailability();

      expect(result).toHaveLength(1);
      const prop = result[0]!;
      expect(prop.amiTier).toBe("60% AMI");
      expect(prop.rentRange).toEqual({
        studio: { low: 850, high: 850 },
        br1: { low: 975, high: 1100 },
        br2: { low: 1200, high: 1425 },
        br3: { low: 1500, high: 1700 },
      });
    });

    it("returns null for bedroom buckets with no units (min/max NULL from SQL)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeAggregateRow({
            studio_count: 0,
            studio_rent_min: null,
            studio_rent_max: null,
            br3_count: 0,
            br3_rent_min: null,
            br3_rent_max: null,
          }),
        ],
      } as any);

      const result = await service.listWithAvailability();
      const prop = result[0]!;

      expect(prop.rentRange.studio).toBeNull();
      expect(prop.rentRange.br3).toBeNull();
      // Populated buckets still come through.
      expect(prop.rentRange.br1).toEqual({ low: 975, high: 1100 });
      expect(prop.rentRange.br2).toEqual({ low: 1200, high: 1425 });
    });

    it("maps market-rate properties (empty/null ami_set_aside) to amiTier=null", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeAggregateRow({ ami_set_aside: null }),
          makeAggregateRow({ ami_set_aside: "" }),
        ],
      } as any);

      const result = await service.listWithAvailability();

      expect(result).toHaveLength(2);
      expect(result[0]!.amiTier).toBeNull();
      expect(result[1]!.amiTier).toBeNull();
    });

    it("coerces NUMERIC strings (pg) to integer dollars in rent ranges", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeAggregateRow({
            // pg's NUMERIC type comes back as a string by default.
            br1_rent_min: "995.00",
            br1_rent_max: "1194.50",
          }),
        ],
      } as any);

      const result = await service.listWithAvailability();
      const prop = result[0]!;
      // Rents are stored whole-dollar in seed.ts; we round defensively.
      expect(prop.rentRange.br1).toEqual({ low: 995, high: 1195 });
    });
  });

  describe("getRentRange", () => {
    it("returns null when the property does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.getRentRange("missing");
      expect(result).toBeNull();
    });

    it("returns per-bedroom rent buckets and the AMI tier", async () => {
      // First query: ami_set_aside lookup. Second query: rent aggregate.
      mockQuery
        .mockResolvedValueOnce({ rows: [{ ami_set_aside: "60% AMI" }] } as any)
        .mockResolvedValueOnce({
          rows: [
            {
              studio_min: 747,
              studio_max: 747,
              br1_min: 995,
              br1_max: 995,
              br2_min: 1194,
              br2_max: 1194,
              br3_min: null,
              br3_max: null,
            },
          ],
        } as any);

      const result = await service.getRentRange(PROPERTY_ID);

      expect(result).toEqual({
        propertyId: PROPERTY_ID,
        amiTier: "60% AMI",
        rentRange: {
          studio: { low: 747, high: 747 },
          br1: { low: 995, high: 995 },
          br2: { low: 1194, high: 1194 },
          br3: null,
        },
      });
    });
  });

  describe("update", () => {
    it("throws when no fields are provided", async () => {
      await expect(
        service.update(PROPERTY_ID, {}, ACTOR_ID, ACTOR_ROLE)
      ).rejects.toThrow("No fields provided for update");

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it("throws when the property does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as any);

      await expect(
        service.update(PROPERTY_ID, { name: "Renamed" }, ACTOR_ID, ACTOR_ROLE)
      ).rejects.toThrow(`Property not found: ${PROPERTY_ID}`);
    });

    it("updates only the provided fields and stringifies JSON payloads", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makePropertyRow({
            name: "Renamed Property",
            unit_mix: { studio: 12 },
            waiting_list_enabled: true,
          }),
        ],
      } as any);

      const result = await service.update(
        PROPERTY_ID,
        {
          name: "Renamed Property",
          unitMix: { studio: 12 },
          waitingListEnabled: true,
        },
        ACTOR_ID,
        ACTOR_ROLE
      );

      const sql = mockQuery.mock.calls[0]?.[0] as string;
      const params = mockQuery.mock.calls[0]?.[1] as unknown[];

      expect(sql).toMatch(/name = \$2/);
      expect(sql).toMatch(/unit_mix = \$3/);
      expect(sql).toMatch(/waiting_list_enabled = \$4/);
      expect(sql).not.toMatch(/ami_area =/);
      expect(params).toEqual([
        PROPERTY_ID,
        "Renamed Property",
        JSON.stringify({ studio: 12 }),
        true,
      ]);
      expect(result).toEqual(
        expect.objectContaining({
          name: "Renamed Property",
          unitMix: { studio: 12 },
          waitingListEnabled: true,
        })
      );
    });

    it("writes a property_updated audit log with the requested changes", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makePropertyRow({ total_vacancy: 7 })],
      } as any);

      await service.update(
        PROPERTY_ID,
        { totalVacancy: 7 },
        ACTOR_ID,
        ACTOR_ROLE
      );

      expect(mockWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "property_updated",
          actorId: ACTOR_ID,
          actorRole: ACTOR_ROLE,
          resourceType: "property",
          resourceId: PROPERTY_ID,
          details: { changes: { totalVacancy: 7 } },
        })
      );
    });
  });
});
