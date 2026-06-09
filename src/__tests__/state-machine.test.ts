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
  APP_STATUS_TRANSITIONS,
  canTransition,
  isTerminal,
  validTriggers,
  transition,
  transitionApplicationStatus,
} from "../modules/screening/state-machine";
import { query } from "../config/database";
import { stampV2ScreeningStateTransition } from "../modules/tape/v2-stamp";

jest.mock("../middleware/audit", () => ({ writeAuditLog: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../modules/tape/v2-stamp", () => ({ stampV2ScreeningStateTransition: jest.fn() }));

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockStamp = stampV2ScreeningStateTransition as jest.MockedFunction<
  typeof stampV2ScreeningStateTransition
>;

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

// ── application_status chokepoint (transitionApplicationStatus) ──────────────

describe("transitionApplicationStatus (application_status chokepoint)", () => {
  const audit = require("../middleware/audit") as { writeAuditLog: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("APP_STATUS_TRANSITIONS fans out from submitted/awaiting_identity/awaiting_consumer_report/screening (+screening_review hold) into the screening terminals", () => {
    // screening_review is a non-terminal hold: a could-not-screen pipeline
    // lands there, and staff resolve it forward to passed/failed. It is both a
    // `to` (from screening) and a `from` (manual override out).
    // awaiting_identity (Phase 4b) sits between submitted and screening: the app
    // waits there for the applicant's Stripe Identity capture, then the webhook
    // advances it into `screening` (or `screening_review` on could_not_screen).
    // awaiting_consumer_report (CRA: Checkr background + TransUnion ShareAble
    // credit) is the analogous gate: the app waits for the applicant to authorize
    // the consumer-report pulls + pass KBA, then the CRA webhook advances it into
    // `screening` (or `screening_review` on could_not_screen).
    // pending_adverse_action is a flag-gated hold (FCRA_PRE_ADVERSE_ENABLED): a
    // denial parks there for the dispute window, is both a `to` (from screening/
    // screening_review) and a `from` (finalizer -> screening_failed, or staff
    // reopen -> screening_review).
    const froms = new Set(APP_STATUS_TRANSITIONS.map((t) => t.from));
    expect(froms).toEqual(
      new Set([
        "submitted",
        "awaiting_identity",
        "awaiting_consumer_report",
        "screening",
        "screening_review",
        "pending_adverse_action",
      ])
    );
    expect(
      APP_STATUS_TRANSITIONS.every((t) =>
        [
          "awaiting_identity",
          "awaiting_consumer_report",
          "screening",
          "screening_review",
          "screening_passed",
          "screening_failed",
          "pending_adverse_action",
        ].includes(t.to)
      )
    ).toBe(true);
  });

  // ── pre-adverse-action window transitions (flag-gated FCRA_PRE_ADVERSE_ENABLED) ──

  it("screening -> pending_adverse_action is valid ONLY with trigger 'pre_adverse_action_started'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-paa" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "screening",
        to: "pending_adverse_action",
        trigger: "pre_adverse_action_started",
        actorId: "user-1",
        actorRole: "leasing_agent",
      })
    ).resolves.toEqual({ changed: true, status: "pending_adverse_action" });
  });

  it("rejects screening -> pending_adverse_action under a wrong trigger", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "screening",
        to: "pending_adverse_action",
        // any_check_failed is the immediate-path trigger; it must NOT open the
        // pre-adverse hold.
        trigger: "any_check_failed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("screening_review -> pending_adverse_action is valid ONLY with trigger 'pre_adverse_action_started'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-paa" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "screening_review",
        to: "pending_adverse_action",
        trigger: "pre_adverse_action_started",
        actorId: "user-sm",
        actorRole: "senior_manager",
      })
    ).resolves.toEqual({ changed: true, status: "pending_adverse_action" });
  });

  it("rejects screening_review -> pending_adverse_action under a wrong trigger", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "screening_review",
        to: "pending_adverse_action",
        trigger: "manual_override_fail",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("pending_adverse_action -> screening_failed is valid ONLY with trigger 'adverse_action_finalized' (system finalizer)", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-paa" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "pending_adverse_action",
        to: "screening_failed",
        trigger: "adverse_action_finalized",
        // system actor — nullable UUID FK; never the string "system"
        actorId: undefined,
        actorRole: "system",
        evidence: { finalizedBy: "pre_adverse_window_scheduler" },
      })
    ).resolves.toEqual({ changed: true, status: "screening_failed" });
  });

  it("rejects pending_adverse_action -> screening_failed under a wrong trigger", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "pending_adverse_action",
        to: "screening_failed",
        // any_check_failed / manual_override_fail are other paths into
        // screening_failed; the finalizer must use its own trigger.
        trigger: "any_check_failed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("pending_adverse_action -> screening_review is valid ONLY with trigger 'dispute_filed' (staff reopen)", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-paa" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "pending_adverse_action",
        to: "screening_review",
        trigger: "dispute_filed",
        actorId: "staff-1",
        actorRole: "leasing_agent",
      })
    ).resolves.toEqual({ changed: true, status: "screening_review" });
  });

  it("rejects pending_adverse_action -> screening_review under a wrong trigger", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-paa",
        from: "pending_adverse_action",
        to: "screening_review",
        trigger: "could_not_screen",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── could_not_screen hold + staff-resolution transitions (Phase: screening_review) ──

  it("screening -> screening_review is valid ONLY with trigger 'could_not_screen'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-cns" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-cns",
        from: "screening",
        to: "screening_review",
        trigger: "could_not_screen",
        actorId: "system",
        actorRole: "system",
        evidence: { overallResult: "could_not_screen" },
      })
    ).resolves.toEqual({ changed: true, status: "screening_review" });

    // CAS UPDATE params: [id, to, from, trigger, actorId, actorRole, evidenceJson]
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([
      "app-cns",
      "screening_review",
      "screening",
      "could_not_screen",
      "system",
      "system",
      JSON.stringify({ overallResult: "could_not_screen" }),
    ]);
    expect(mockStamp).toHaveBeenCalledTimes(1);
  });

  it("rejects screening -> screening_review under any trigger other than 'could_not_screen'", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-cns",
        from: "screening",
        to: "screening_review",
        trigger: "any_check_failed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("screening_review -> screening_passed is valid ONLY with trigger 'manual_override_pass'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-cns" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-cns",
        from: "screening_review",
        to: "screening_passed",
        trigger: "manual_override_pass",
        actorId: "staff-1",
        actorRole: "leasing_agent",
      })
    ).resolves.toEqual({ changed: true, status: "screening_passed" });
  });

  it("rejects screening_review -> screening_passed under a wrong trigger", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-cns",
        from: "screening_review",
        to: "screening_passed",
        // all_checks_passed is valid for screening->screening_passed, but NOT
        // for the manual staff override out of the hold.
        trigger: "all_checks_passed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("screening_review -> screening_failed is valid ONLY with trigger 'manual_override_fail'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-cns" }] } as any);

    await expect(
      transitionApplicationStatus({
        applicationId: "app-cns",
        from: "screening_review",
        to: "screening_failed",
        trigger: "manual_override_fail",
        actorId: "staff-1",
        actorRole: "leasing_agent",
      })
    ).resolves.toEqual({ changed: true, status: "screening_failed" });
  });

  it("rejects screening_review -> screening_failed under a wrong trigger", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-cns",
        from: "screening_review",
        to: "screening_failed",
        // any_check_failed is valid for screening->screening_failed, but NOT
        // for the manual staff override out of the hold.
        trigger: "any_check_failed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("on a winning CAS: writes status+history, audit row, tape stamp, returns changed:true", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "app-1" }] } as any);

    const res = await transitionApplicationStatus({
      applicationId: "app-1",
      from: "screening",
      to: "screening_passed",
      trigger: "all_checks_passed",
      actorId: "user-1",
      actorRole: "leasing_agent",
      evidence: { overallResult: "pass" },
    });

    expect(res).toEqual({ changed: true, status: "screening_passed" });

    // CAS UPDATE params: [id, to, from, trigger, actorId, actorRole, evidenceJson]
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND status = \$3/);
    expect(params).toEqual([
      "app-1",
      "screening_passed",
      "screening",
      "all_checks_passed",
      "user-1",
      "leasing_agent",
      JSON.stringify({ overallResult: "pass" }),
    ]);

    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "screening_state_transition",
        applicationId: "app-1",
        details: expect.objectContaining({
          fromStatus: "screening",
          toStatus: "screening_passed",
          trigger: "all_checks_passed",
        }),
      })
    );
    expect(mockStamp).toHaveBeenCalledTimes(1);
  });

  it("on a losing CAS (0 rows): no audit, no tape, returns changed:false", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);

    const res = await transitionApplicationStatus({
      applicationId: "app-1",
      from: "screening",
      to: "screening_failed",
      trigger: "any_check_failed",
    });

    expect(res).toEqual({ changed: false, status: "screening_failed" });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
    expect(mockStamp).not.toHaveBeenCalled();
  });

  it("throws on an undefined (from,to) pair without touching the DB", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-1",
        from: "submitted",
        to: "screening_passed",
        trigger: "all_checks_passed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("throws when the trigger is valid elsewhere but wrong for this (from,to)", async () => {
    await expect(
      transitionApplicationStatus({
        applicationId: "app-1",
        from: "screening",
        to: "screening_failed",
        trigger: "all_checks_passed",
      })
    ).rejects.toThrow(/Invalid application_status transition/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("every APP_STATUS_TRANSITIONS row is accepted by the validator", async () => {
    for (const t of APP_STATUS_TRANSITIONS) {
      mockQuery.mockResolvedValue({ rows: [{ id: "x" }] } as any);
      await expect(
        transitionApplicationStatus({
          applicationId: "x",
          from: t.from,
          to: t.to,
          trigger: t.trigger,
        })
      ).resolves.toEqual({ changed: true, status: t.to });
    }
  });
});
