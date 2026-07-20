import { logger } from "./logger";

/**
 * Graceful shutdown (backlog #11): on a deploy SIGTERM/SIGINT, stop the cron
 * scheduler (so no NEW money job starts mid-drain), stop accepting new
 * connections, let in-flight requests drain, then release the pg pool so exit
 * is clean rather than mid-query. Hard-stop after `backstopMs` as a backstop.
 *
 * Factory over injected deps so the sequence is unit-testable without
 * spawning the boot path or sending real signals; index.ts passes the live
 * server/scheduler/pool.
 */
export interface ShutdownDeps {
  stopScheduler: () => void;
  server: { close: (cb: () => void) => unknown };
  pool: { end: () => Promise<unknown> };
  exit?: (code: number) => void;
  backstopMs?: number;
}

export function createShutdown(deps: ShutdownDeps): (sig: string) => void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const backstopMs = deps.backstopMs ?? 10_000;
  return (sig: string): void => {
    logger.info(`${sig} received — draining connections before exit`);
    deps.stopScheduler();
    deps.server.close(() => {
      void deps.pool
        .end()
        .catch(() => undefined)
        .finally(() => exit(0));
    });
    setTimeout(() => exit(0), backstopMs).unref();
  };
}
