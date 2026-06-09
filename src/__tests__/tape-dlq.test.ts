/**
 * Unit tests for the compliance-tape dead-letter queue (src/modules/tape/dlq.ts).
 *
 * Mocked: DB (SQL-routed), logger, and the tape service (createTapeService) so
 * replay's stamp() outcome is controllable. Exercises park (insert / cap /
 * never-throw), replay (resolve on success, bump on failure), and stats mapping.
 */

jest.mock("../config/database", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStamp = jest.fn();
jest.mock("../modules/tape/service", () => ({
  createTapeService: () => ({ stamp: mockStamp }),
}));
jest.mock("../modules/tape/repository", () => ({
  PgTapeRepository: jest.fn().mockImplementation(() => ({})),
}));

import { query } from "../config/database";
import { logger } from "../utils/logger";
import {
  parkFailedStamp,
  replayTapeDlq,
  getTapeDlqStats,
} from "../modules/tape/dlq";
import type { TapeEvent } from "../modules/tape/types";

const mockQuery = query as jest.MockedFunction<typeof query>;

function makeEvent(overrides: Partial<TapeEvent> = {}): TapeEvent {
  return {
    kind: "acq.award_recorded",
    payload: {
      "@context": "https://schema.org",
      "@type": "AcquisitionComplianceEvent",
      actorId: "staff-1",
      subjectId: null,
      ruleCitation: "IRC §42 + NV 2026 QAP §3",
      evidence: { awardId: "award-1", propertyId: "prop-1" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("parkFailedStamp", () => {
  it("inserts the failed stamp when under the active-row cap", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT COUNT(*)")) return { rows: [{ count: 3 }] } as any;
      return { rows: [] } as any; // the INSERT
    });

    await parkFailedStamp(makeEvent({ sessionId: "sess-9" }), new Error("tape down"));

    const insert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO compliance_tape_dlq")
    );
    expect(insert).toBeTruthy();
    const params = insert![1] as unknown[];
    expect(params[0]).toBe("acq.award_recorded"); // kind
    expect(params[1]).toBe("sess-9"); // session_id
    expect(JSON.parse(params[2] as string)).toMatchObject({
      evidence: { awardId: "award-1" },
    }); // payload json
    expect(params[3]).toBe("tape down"); // error message
  });

  it("maps an absent sessionId to null", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT COUNT(*)")) return { rows: [{ count: 0 }] } as any;
      return { rows: [] } as any;
    });

    await parkFailedStamp(makeEvent(), new Error("x"));

    const insert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO compliance_tape_dlq")
    );
    expect((insert![1] as unknown[])[1]).toBeNull();
  });

  it("skips the insert and warns when the DLQ is at capacity", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT COUNT(*)")) return { rows: [{ count: 10_000 }] } as any;
      return { rows: [] } as any;
    });

    await parkFailedStamp(makeEvent(), new Error("x"));

    const insert = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO compliance_tape_dlq")
    );
    expect(insert).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "compliance-tape DLQ at capacity — skipping new row",
      expect.objectContaining({ cap: 10_000 })
    );
  });

  it("never throws even when the DLQ write itself fails", async () => {
    mockQuery.mockRejectedValue(new Error("db gone"));

    await expect(
      parkFailedStamp(makeEvent(), new Error("x"))
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "compliance-tape DLQ insert failed",
      expect.objectContaining({ kind: "acq.award_recorded" })
    );
  });
});

describe("replayTapeDlq", () => {
  const row = {
    id: "dlq-1",
    kind: "acq.units_designated",
    session_id: null,
    payload: makeEvent().payload,
    attempt_count: 1,
  };

  it("re-stamps and marks the row resolved on success", async () => {
    mockStamp.mockResolvedValue({ id: "tape-1" });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, kind")) return { rows: [row] } as any;
      return { rows: [] } as any; // the UPDATE
    });

    const result = await replayTapeDlq();

    expect(result).toEqual({ scanned: 1, replayed: 1, failed: 0 });
    expect(mockStamp).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "acq.units_designated", sessionId: undefined })
    );
    const update = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("SET resolved_at = NOW()")
    );
    expect(update![1]).toEqual(["dlq-1"]);
  });

  it("bumps attempt_count and does not resolve on a repeat failure", async () => {
    mockStamp.mockRejectedValue(new Error("still down"));
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, kind")) return { rows: [row] } as any;
      return { rows: [] } as any;
    });

    const result = await replayTapeDlq();

    expect(result).toEqual({ scanned: 1, replayed: 0, failed: 1 });
    const resolved = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("SET resolved_at = NOW()")
    );
    expect(resolved).toBeUndefined();
    const bump = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("SET attempt_count = attempt_count + 1")
    );
    expect(bump![1]).toEqual(["dlq-1", "still down"]);
  });

  it("returns a zero result when nothing is parked", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    const result = await replayTapeDlq();
    expect(result).toEqual({ scanned: 0, replayed: 0, failed: 0 });
    expect(mockStamp).not.toHaveBeenCalled();
  });

  it("only scans rows under the attempt cap (MAX_REPLAY_ATTEMPTS bind param)", async () => {
    mockQuery.mockResolvedValue({ rows: [] } as any);
    await replayTapeDlq({ limit: 25 });
    const select = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("SELECT id, kind")
    );
    expect(select![1]).toEqual([5, 25]); // [MAX_REPLAY_ATTEMPTS, limit]
  });
});

describe("getTapeDlqStats", () => {
  it("maps the aggregate counts", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ unresolved: 2, resolved: 7, exhausted: 1 }],
    } as any);
    const stats = await getTapeDlqStats();
    expect(stats).toEqual({ unresolved: 2, resolved: 7, exhausted: 1 });
  });
});
