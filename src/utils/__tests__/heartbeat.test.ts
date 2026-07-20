/**
 * Background-job liveness primitive (backlog #12).
 *
 * The load-bearing contract: recordHeartbeat NEVER throws — a liveness write
 * failing must not take down the job it instruments (the beat's absence is
 * itself the alarm, read by /health as staleness).
 */
import { recordHeartbeat, getHeartbeat, DIALER_HEARTBEAT } from "../heartbeat";
import { query } from "../../config/database";
import { logger } from "../logger";

jest.mock("../../config/database", () => ({
  query: jest.fn(),
}));

jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const queryMock = query as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe("recordHeartbeat", () => {
  it("upserts the named beat with detail", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await recordHeartbeat(DIALER_HEARTBEAT, { action: "queue_empty" });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO service_heartbeats/);
    expect(sql).toMatch(/ON CONFLICT \(name\) DO UPDATE/);
    expect(params).toEqual([DIALER_HEARTBEAT, JSON.stringify({ action: "queue_empty" })]);
  });

  it("stores NULL detail when none given", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await recordHeartbeat("some_job");

    expect(queryMock.mock.calls[0][1]).toEqual(["some_job", null]);
  });

  it("swallows DB failure (logged, not thrown)", async () => {
    queryMock.mockRejectedValue(new Error("db down"));

    await expect(recordHeartbeat("some_job")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "recordHeartbeat failed",
      expect.objectContaining({ name: "some_job", error: "db down" })
    );
  });
});

describe("getHeartbeat", () => {
  it("returns the beat with a Date", async () => {
    queryMock.mockResolvedValue({
      rows: [{ beat_at: "2026-07-02T17:00:00.000Z", detail: { action: "dialed" } }],
    });

    const hb = await getHeartbeat(DIALER_HEARTBEAT);

    expect(hb?.beatAt).toEqual(new Date("2026-07-02T17:00:00.000Z"));
    expect(hb?.detail).toEqual({ action: "dialed" });
  });

  it("returns null when the job never beat", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await expect(getHeartbeat("never_ran")).resolves.toBeNull();
  });
});
