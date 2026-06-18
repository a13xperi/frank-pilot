import {
  ApBillAction,
  canTransition,
  isTerminal,
  nextState,
  postingMomentFor,
  settlePaymentState,
} from "../ap-state-machine";
import { ApBillStatus } from "../types";

describe("AP bill state machine", () => {
  it("walks the happy path draft → submitted → approved → scheduled → paid", () => {
    expect(nextState("draft", "submit")).toBe("submitted");
    expect(nextState("submitted", "approve")).toBe("approved");
    expect(nextState("approved", "schedule")).toBe("scheduled");
    expect(nextState("scheduled", "record_payment")).toBe("partially_paid");
  });

  it("allows reject only from submitted", () => {
    expect(nextState("submitted", "reject")).toBe("rejected");
    expect(canTransition("draft", "reject")).toBe(false);
    expect(canTransition("approved", "reject")).toBe(false);
  });

  it("allows void from any non-terminal pre-/mid-approval state, not from paid/terminal", () => {
    for (const s of ["draft", "submitted", "approved", "scheduled"] as ApBillStatus[]) {
      expect(nextState(s, "void")).toBe("voided");
    }
    expect(canTransition("paid", "void")).toBe(false);
    expect(canTransition("voided", "void")).toBe(false);
    expect(canTransition("rejected", "void")).toBe(false);
  });

  it("treats paid, rejected, voided as terminal", () => {
    for (const t of ["paid", "rejected", "voided"] as ApBillStatus[]) {
      expect(isTerminal(t)).toBe(true);
      for (const a of ["submit", "approve", "reject", "schedule", "record_payment", "void"] as ApBillAction[]) {
        expect(canTransition(t, a)).toBe(false);
      }
    }
  });

  it("rejects out-of-order transitions (approve before submit, pay a draft)", () => {
    expect(canTransition("draft", "approve")).toBe(false);
    expect(canTransition("draft", "record_payment")).toBe(false);
    expect(() => nextState("draft", "approve")).toThrow(/Illegal AP bill transition/);
  });

  it("allows recording a payment from approved (skipping explicit schedule)", () => {
    expect(nextState("approved", "record_payment")).toBe("partially_paid");
  });

  it("can record further payments from partially_paid", () => {
    expect(nextState("partially_paid", "record_payment")).toBe("partially_paid");
  });
});

describe("settlePaymentState", () => {
  it("returns partially_paid when payment < amount", () => {
    expect(settlePaymentState(100, 40)).toBe("partially_paid");
  });
  it("returns paid when cumulative payment >= amount", () => {
    expect(settlePaymentState(100, 100)).toBe("paid");
    expect(settlePaymentState(100, 100.0)).toBe("paid");
  });
  it("treats overpayment as paid", () => {
    expect(settlePaymentState(100, 120)).toBe("paid");
  });
  it("is exact at the cent boundary", () => {
    expect(settlePaymentState(0.3, 0.3)).toBe("paid");
    expect(settlePaymentState(0.3, 0.29)).toBe("partially_paid");
  });
  it("throws when no payment applied", () => {
    expect(() => settlePaymentState(100, 0)).toThrow();
  });
});

describe("postingMomentFor", () => {
  it("maps approve → accrue_payable and record_payment → disburse_payment", () => {
    expect(postingMomentFor("approve")).toBe("accrue_payable");
    expect(postingMomentFor("record_payment")).toBe("disburse_payment");
  });
  it("maps non-posting actions to null", () => {
    for (const a of ["submit", "reject", "schedule", "void"] as ApBillAction[]) {
      expect(postingMomentFor(a)).toBeNull();
    }
  });
});
