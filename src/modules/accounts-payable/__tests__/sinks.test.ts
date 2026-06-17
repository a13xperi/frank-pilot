import {
  selectDisbursementSink,
  RealPageSink,
  InPlatformPrintSink,
  type DisburseInput,
} from "../sinks";

const INPUT: DisburseInput = {
  checkId: "00000000-0000-0000-0000-000000000001",
  propertyId: "00000000-0000-0000-0000-000000000002",
  amountCents: 184500,
  checkNumber: "1042",
  memo: { invoiceNumber: "SPM-2041", billingNumber: "B-7781", unitNumber: "12B" },
};

describe("AP disbursement sink (DM-FRANK-023 seam)", () => {
  it("defaults to the RealPage sink (the CFO's current lean)", () => {
    expect(selectDisbursementSink(undefined).kind).toBe("realpage");
  });

  it("selects the in-platform print sink when AP_DISBURSEMENT_SINK=print", () => {
    expect(selectDisbursementSink("print").kind).toBe("print");
  });

  it("throws on an unknown sink rather than guessing", () => {
    expect(() => selectDisbursementSink("bogus")).toThrow(/Unknown AP_DISBURSEMENT_SINK/);
  });

  it("RealPage sink fails loud without creds (honest-stub rule)", async () => {
    const prevEnabled = process.env.REALPAGE_AP_ENABLED;
    const prevKey = process.env.REALPAGE_AP_API_KEY;
    delete process.env.REALPAGE_AP_ENABLED;
    delete process.env.REALPAGE_AP_API_KEY;
    try {
      await expect(new RealPageSink().disburse(INPUT)).rejects.toThrow(/not configured/);
    } finally {
      if (prevEnabled !== undefined) process.env.REALPAGE_AP_ENABLED = prevEnabled;
      if (prevKey !== undefined) process.env.REALPAGE_AP_API_KEY = prevKey;
    }
  });

  it("in-platform print sink is gated until DM-FRANK-023 picks Shape B", async () => {
    await expect(new InPlatformPrintSink().disburse(INPUT)).rejects.toThrow(/not implemented/);
  });
});
