/**
 * B2 — Form 8823 export data assembly.
 *
 * Mock `query` returns synthetic out-of-compliance recert rows; a mock tape
 * service returns the global compliance chain. Asserts category classification,
 * corrected-finding filtering, BIN mapping, evidence attachment (filtered to the
 * recert), the rollup summary, and the CSV summary helper. No DB, no real tape.
 */
import {
  Form8823Service,
  summarizeForm8823,
  type QueryFn,
} from "../modules/recertification/form-8823";
import type { TapeService } from "../modules/tape/service";

jest.mock("../config/database", () => ({
  query: jest.fn(() => { throw new Error("real query must not be called"); }),
}));
// Guard the default tape repo construction.
jest.mock("../modules/tape/repository", () => ({
  PgTapeRepository: jest.fn(() => ({})),
}));
jest.mock("../modules/tape/service", () => ({
  createTapeService: jest.fn(() => ({
    list: jest.fn(async () => []),
  })),
}));

function recertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "recert-1",
    tenant_name: "Jane Doe",
    income_ceiling_verdict: "over_income",
    income_ceiling_income: "62000.00",
    income_ceiling_limit: "45000.00",
    income_ceiling_checked_at: new Date("2026-06-01T00:00:00Z"),
    nau_status: "open",
    nau_resolved_at: null,
    market_rent_applied_at: null,
    unit_number: "4B",
    ami_designation: "50",
    property_id: "prop-1",
    property_name: "Donna Louise",
    address_line1: "123 Main St",
    city: "Las Vegas",
    state: "NV",
    bin: "NV-2026-00012",
    bin_confidence: "confirmed",
    building_code: "A",
    ...overrides,
  };
}

function makeService(rows: any[], tapeEntries: any[] = []) {
  const query = jest.fn(async () => ({ rows })) as unknown as jest.MockedFunction<QueryFn>;
  const tape = {
    list: jest.fn(async () => tapeEntries),
  } as unknown as TapeService;
  const svc = new Form8823Service({ query, tape });
  return { svc, query, tape };
}

describe("Form8823Service.assemble", () => {
  it("classifies an open over-income recert as 11c and maps the BIN", async () => {
    const { svc } = makeService([recertRow()]);
    const report = await svc.assemble({ withEvidence: false });

    expect(report.records).toHaveLength(1);
    const r = report.records[0];
    expect(r.category).toBe("over_income_recert");
    expect(r.lineReference).toContain("11c");
    expect(r.bin).toBe("NV-2026-00012");
    expect(r.unitNumber).toBe("4B");
    expect(r.income).toBe(62000);
    expect(r.incomeLimit).toBe(45000);
    expect(r.corrected).toBe(false);
    expect(r.propertyAddress).toBe("123 Main St, Las Vegas, NV");
  });

  it("classifies nau_status='lost' as nau_lost and market_rent as its own category", async () => {
    const { svc } = makeService([
      recertRow({ id: "r-lost", nau_status: "lost" }),
      recertRow({
        id: "r-mkt", income_ceiling_verdict: "qualified", nau_status: null,
        market_rent_applied_at: new Date("2026-05-15T00:00:00Z"),
      }),
    ]);
    const report = await svc.assemble({ withEvidence: false });
    const byId = Object.fromEntries(report.records.map((r) => [r.recertId, r.category]));
    expect(byId["r-lost"]).toBe("nau_lost");
    expect(byId["r-mkt"]).toBe("market_rent_applied");
  });

  it("excludes corrected (NAU satisfied) findings unless includeCorrected", async () => {
    const rows = [recertRow({ id: "r-fixed", nau_status: "satisfied",
      nau_resolved_at: new Date("2026-06-10T00:00:00Z") })];

    const def = await makeService(rows).svc.assemble({ withEvidence: false });
    expect(def.records).toHaveLength(0); // corrected excluded by default

    const inc = await makeService(rows).svc.assemble({ withEvidence: false, includeCorrected: true });
    expect(inc.records).toHaveLength(1);
    expect(inc.records[0].corrected).toBe(true);
    expect(inc.records[0].dateCorrected).toContain("2026-06-10");
  });

  it("attaches only this recert's acq tape entries as evidence", async () => {
    const tapeEntries = [
      { kind: "acq.recert_income_checked", sequence: 5, entryHash: "h5",
        createdAt: "2026-06-01T00:00:00Z",
        payload: { ruleCitation: "IRC §42", evidence: { recertId: "recert-1" } } },
      { kind: "acq.nau_triggered", sequence: 6, entryHash: "h6",
        createdAt: "2026-06-01T00:01:00Z",
        payload: { ruleCitation: "IRC §42 NAU", evidence: { recertId: "recert-1" } } },
      // Different recert — must be filtered out.
      { kind: "acq.nau_triggered", sequence: 7, entryHash: "h7",
        createdAt: "2026-06-02T00:00:00Z",
        payload: { ruleCitation: "x", evidence: { recertId: "other" } } },
      // Unrelated kind — must be filtered out.
      { kind: "application.submitted", sequence: 8, entryHash: "h8",
        createdAt: "2026-06-02T00:00:00Z",
        payload: { evidence: { recertId: "recert-1" } } },
    ];
    const { svc, tape } = makeService([recertRow()], tapeEntries);
    const report = await svc.assemble({ withEvidence: true });

    expect(tape.list).toHaveBeenCalledWith({ type: "global" });
    const ev = report.records[0].evidence;
    expect(ev.map((e) => e.entryHash).sort()).toEqual(["h5", "h6"]);
    expect(ev[0].ruleCitation).toContain("IRC §42");
  });

  it("computes the rollup summary (open/corrected/byCategory/binsAffected)", async () => {
    const { svc } = makeService([
      recertRow({ id: "a", bin: "BIN-1" }),                                  // over_income open
      recertRow({ id: "b", nau_status: "lost", bin: "BIN-2" }),             // nau_lost open
      recertRow({ id: "c", nau_status: "satisfied", bin: "BIN-1",          // corrected
        nau_resolved_at: new Date() }),
    ]);
    const report = await svc.assemble({ withEvidence: false, includeCorrected: true });
    expect(report.summary.total).toBe(3);
    expect(report.summary.open).toBe(2);
    expect(report.summary.corrected).toBe(1);
    expect(report.summary.byCategory.over_income_recert).toBe(2); // a + c
    expect(report.summary.byCategory.nau_lost).toBe(1);
    expect(report.summary.binsAffected).toBe(2); // BIN-1 + BIN-2 have open findings
  });

  it("passes a property filter into the query params", async () => {
    const { svc, query } = makeService([]);
    await svc.assemble({ propertyId: "prop-9", withEvidence: false });
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toContain("prop-9");
  });
});

describe("summarizeForm8823", () => {
  it("emits one pipe-delimited line per record", async () => {
    const { svc } = makeService([recertRow()]);
    const report = await svc.assemble({ withEvidence: false });
    const lines = summarizeForm8823(report);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NV-2026-00012");
    expect(lines[0]).toContain("OPEN");
    expect(lines[0]).toContain("over_income_recert");
  });
});
