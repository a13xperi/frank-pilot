/**
 * Tests for src/modules/screening/state-machine.ts
 *
 * Pure-logic coverage for the screening state machine: canTransition,
 * validTriggers, isTerminal, and transition() error paths. The async
 * transition() side-effects (audit log write) are mocked — this suite is
 * about the transition table and guard logic, not the audit substrate.
 */

import {
  TRANSITIONS,
  TERMINAL_STATES,
  canTransition,
  isTerminal,
  validTriggers,
  transition,
} from "../modules/screening/state-machine";

jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe("screening state machine — table", () => {
  it("flags terminal states correctly", () => {
    expect(isTerminal("passed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("withdrawn")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("id_verifying")).toBe(false);
    expect(isTerminal("manual_review")).toBe(false);
  });

  it("TERMINAL_STATES matches isTerminal", () => {
    for (const s of TERMINAL_STATES) {
      expect(isTerminal(s)).toBe(true);
    }
  });
});

describe("canTransition", () => {
  it("allows defined transitions", () => {
    expect(canTransition("queued", "id_verifying")).toBe(true);
    expect(canTransition("id_verified", "fraud_screening")).toBe(true);
    expect(canTransition("screening", "passed")).toBe(true);
    expect(canTransition("manual_review", "failed")).toBe(true);
  });

  it("rejects undefined transitions", () => {
    expect(canTransition("queued", "passed")).toBe(false);
    expect(canTransition("id_verifying", "screening")).toBe(false);
    expect(canTransition("fraud_screening", "passed")).toBe(false);
  });

  it("blocks egress from terminal states", () => {
    expect(canTransition("passed", "manual_review")).toBe(false);
    expect(canTransition("failed", "screening")).toBe(false);
    expect(canTransition("withdrawn", "queued")).toBe(false);
  });

  it("permits 'applicant_withdrew' from every non-terminal state", () => {
    const nonTerminal = ["queued", "id_verifying", "fraud_screening", "screening", "manual_review"] as const;
    for (const s of nonTerminal) {
      expect(canTransition(s, "withdrawn")).toBe(true);
    }
  });
});

describe("validTriggers", () => {
  it("returns the trigger label for a defined transition", () => {
    expect(validTriggers("queued", "id_verifying")).toEqual(["screening_initiated"]);
    expect(validTriggers("screening", "failed")).toEqual(["any_check_failed"]);
  });

  it("returns [] for an undefined transition", () => {
    expect(validTriggers("queued", "passed")).toEqual([]);
    expect(validTriggers("passed", "failed")).toEqual([]);
  });

  it("every entry in TRANSITIONS round-trips through validTriggers", () => {
    for (const t of TRANSITIONS) {
      expect(validTriggers(t.from, t.to)).toContain(t.trigger);
    }
  });
});

describe("transition()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes an audit log on a valid transition", async () => {
    const audit = require("../middleware/audit") as { writeAuditLog: jest.Mock };

    await transition({
      applicationId: "app-123",
      from: "queued",
      to: "id_verifying",
      trigger: "screening_initiated",
      actorId: "system",
      actorRole: "system",
    });

    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "screening_state_transition",
        applicationId: "app-123",
        details: expect.objectContaining({
          fromState: "queued",
          toState: "id_verifying",
          trigger: "screening_initiated",
        }),
      })
    );
  });

  it("throws on an undefined transition", async () => {
    await expect(
      transition({
        applicationId: "app-x",
        from: "queued",
        to: "passed",
        trigger: "screening_initiated",
      })
    ).rejects.toThrow(/no transition defined/);
  });

  it("throws when attempting to leave a terminal state", async () => {
    await expect(
      transition({
        applicationId: "app-x",
        from: "passed",
        to: "manual_review",
        trigger: "manual_override_pass",
      })
    ).rejects.toThrow(/terminal state/);
  });

  it("throws when the trigger does not match the transition", async () => {
    await expect(
      transition({
        applicationId: "app-x",
        from: "queued",
        to: "id_verifying",
        trigger: "fraud_flag_raised",
      })
    ).rejects.toThrow(/Invalid trigger/);
  });
});
