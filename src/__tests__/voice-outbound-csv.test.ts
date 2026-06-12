/**
 * Unit tests for src/modules/voice-outbound/csv.ts — the deliberately-minimal
 * wait-list CSV ingester. Pins the header fuzziness and the quoting rules an
 * operator export will actually exercise.
 */

import { parseWaitlistCsv, splitCsvLine } from "../modules/voice-outbound/csv";

describe("splitCsvLine", () => {
  it("handles quoted fields with embedded commas and escaped quotes", () => {
    expect(splitCsvLine('"Doe, Jane",702-555-0100,"says ""call after 5"""')).toEqual([
      "Doe, Jane",
      "702-555-0100",
      'says "call after 5"',
    ]);
  });
});

describe("parseWaitlistCsv", () => {
  it("maps fuzzy operator headers onto canonical columns", () => {
    const csv = [
      "Rank,Applicant Name,Cell,E-mail,BR,Date Added,OK to Call?",
      '1,"Doe, Jane",(702) 555-0100,jane@x.com,2,2025-11-03,Yes',
      "2,John Roe,,,,2026-01-15,",
    ].join("\r\n");

    const { rows, errors } = parseWaitlistCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      position: 1,
      name: "Doe, Jane",
      phone: "(702) 555-0100",
      email: "jane@x.com",
      bedrooms: 2,
      listedAt: "2025-11-03",
      consent: true,
    });
    expect(rows[1]).toMatchObject({ position: 2, name: "John Roe", phone: null, consent: false });
  });

  it("skips no-name rows with a row-numbered error instead of aborting", () => {
    const csv = ["name,phone", "Jane Doe,702-555-0100", ",702-555-0199"].join("\n");
    const { rows, errors } = parseWaitlistCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatch(/row 3/);
  });

  it("rejects a file with no recognizable name column", () => {
    const { rows, errors } = parseWaitlistCsv("foo,bar\n1,2");
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/no recognizable name column/);
  });

  it("consent parsing is strict-truthy — blank or unknown never consents", () => {
    const csv = ["name,consent", "A,yes", "B,no", "C,", "D,maybe", "E,1"].join("\n");
    const { rows } = parseWaitlistCsv(csv);
    expect(rows.map((r) => r.consent)).toEqual([true, false, false, false, true]);
  });
});
