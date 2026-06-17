import { canTransition, nextState, approvalStepFor, type ApCheckState } from "../state-machine";

describe("AP check state machine", () => {
  it("walks the happy path cut → reviewed → signed → disbursed", () => {
    expect(nextState("cut", "review")).toBe("reviewed");
    expect(nextState("reviewed", "sign")).toBe("signed");
    expect(nextState("signed", "disburse")).toBe("disbursed");
  });

  it("allows reject from cut and reviewed, but not from signed", () => {
    expect(nextState("cut", "reject")).toBe("rejected");
    expect(nextState("reviewed", "reject")).toBe("rejected");
    expect(canTransition("signed", "reject")).toBe(false);
  });

  it("allows void from any post-cut state but not from terminal states", () => {
    for (const s of ["cut", "reviewed", "signed", "disbursed"] as ApCheckState[]) {
      expect(nextState(s, "void")).toBe("voided");
    }
    expect(canTransition("voided", "void")).toBe(false);
    expect(canTransition("rejected", "void")).toBe(false);
  });

  it("treats rejected and voided as terminal (re-cut/reissue starts a new check)", () => {
    for (const a of ["review", "sign", "disburse", "reject", "void"] as const) {
      expect(canTransition("rejected", a)).toBe(false);
      expect(canTransition("voided", a)).toBe(false);
    }
  });

  it("rejects out-of-order transitions (sign before review, disburse before sign)", () => {
    expect(canTransition("cut", "sign")).toBe(false);
    expect(canTransition("cut", "disburse")).toBe(false);
    expect(canTransition("reviewed", "disburse")).toBe(false);
    expect(() => nextState("cut", "disburse")).toThrow(/Illegal AP check transition/);
  });

  it("maps only review/sign actions to an approval step", () => {
    expect(approvalStepFor("review")).toBe("review");
    expect(approvalStepFor("sign")).toBe("sign");
    expect(approvalStepFor("disburse")).toBeNull();
    expect(approvalStepFor("void")).toBeNull();
    expect(approvalStepFor("reject")).toBeNull();
  });
});
