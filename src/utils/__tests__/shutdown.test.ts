/**
 * Tests for createShutdown (backlog #11): the deploy-drain sequence must be
 * stopScheduler → server.close (drain) → pool.end → exit(0), with a hard-stop
 * backstop if the drain hangs, and a pool that fails to close must not block
 * the exit. Extracted from src/index.ts into a DI factory precisely so this
 * ordering is assertable without sending real signals.
 */
jest.mock("../logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { createShutdown } from "../shutdown";
import { logger } from "../logger";

function makeDeps(overrides?: {
  poolEnd?: () => Promise<unknown>;
  closeDrains?: boolean;
}) {
  const order: string[] = [];
  const stopScheduler = jest.fn(() => order.push("stopScheduler"));
  const server = {
    close: jest.fn((cb: () => void) => {
      order.push("server.close");
      if (overrides?.closeDrains !== false) cb(); // drained immediately
    }),
  };
  const pool = {
    end: jest.fn(() => {
      order.push("pool.end");
      return overrides?.poolEnd ? overrides.poolEnd() : Promise.resolve();
    }),
  };
  const exit = jest.fn((code: number) => order.push(`exit(${code})`));
  return { order, stopScheduler, server, pool, exit };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => jest.clearAllMocks());

describe("createShutdown", () => {
  it("drains in order: stopScheduler → server.close → pool.end → exit(0)", async () => {
    const deps = makeDeps();
    const shutdown = createShutdown(deps);

    shutdown("SIGTERM");
    await flush();

    expect(deps.order).toEqual(["stopScheduler", "server.close", "pool.end", "exit(0)"]);
    expect(logger.info).toHaveBeenCalledWith(
      "SIGTERM received — draining connections before exit"
    );
  });

  it("still exits 0 when the pool fails to close (never hangs the deploy on a broken pool)", async () => {
    const deps = makeDeps({ poolEnd: () => Promise.reject(new Error("pool stuck")) });
    const shutdown = createShutdown(deps);

    shutdown("SIGINT");
    await flush();

    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it("hard-stops via the backstop when in-flight requests never drain", async () => {
    // Real (tiny) backstop timer — fake timers also fake the setImmediate the
    // drain tests flush on, and jest 30's global restore is unreliable across
    // tests, so a short real wait is the sturdier assertion.
    const deps = makeDeps({ closeDrains: false }); // server.close never calls back
    const shutdown = createShutdown({ ...deps, backstopMs: 25 });

    shutdown("SIGTERM");
    expect(deps.exit).not.toHaveBeenCalled(); // nothing exits synchronously

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.pool.end).not.toHaveBeenCalled(); // drain never finished; backstop won
  });

  it("scheduler stops FIRST so no new money job starts mid-drain", async () => {
    const deps = makeDeps({ closeDrains: false });
    const shutdown = createShutdown(deps);

    shutdown("SIGTERM");

    expect(deps.stopScheduler).toHaveBeenCalledTimes(1);
    expect(deps.order[0]).toBe("stopScheduler");
  });
});
