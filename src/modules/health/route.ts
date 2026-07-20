import { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { externalReachability, dialerTickStatus } from "../../utils/health-checks";

/**
 * GET /health — pings the DB so silent outages don't look healthy, plus the
 * backlog #12 signals: Sage/ElevenLabs reachability and dialer tick-freshness
 * (stale >15 min inside the 9am–8pm PT window ⇒ status "degraded").
 *
 * Only a DB failure flips the HTTP status code (503): Railway's deploy
 * healthcheck keys off the code, so gating it on a vendor blip — or on a
 * dialer that was ALREADY stale when its fix deploys — would turn an
 * observability signal into an outage vector. Alerting reads the body.
 *
 * Extracted from src/index.ts so the mounted route and the jest suite
 * exercise the SAME handler rather than a test-local copy (the old
 * health.test.ts replica had already drifted from the real handler).
 */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  let dbStatus = "unknown";
  try {
    const { query } = await import("../../config/database");
    const r = await query("SELECT 1 AS ok");
    dbStatus = r.rows[0]?.ok === 1 ? "ok" : "unexpected";
  } catch (err) {
    dbStatus = "error";
    logger.error("/health DB ping failed", { error: (err as Error).message });
    res.status(503).json({
      status: "degraded",
      service: "frank-pilot",
      db: dbStatus,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  let sage = "unknown";
  let elevenlabs = "unknown";
  let dialer: Awaited<ReturnType<typeof dialerTickStatus>> | { state: string; healthy: boolean } =
    { state: "unknown", healthy: true };
  try {
    const [reach, dialerStatus] = await Promise.all([
      externalReachability(),
      dialerTickStatus(),
    ]);
    sage = reach.sage;
    elevenlabs = reach.elevenlabs;
    dialer = dialerStatus;
  } catch (err) {
    // Observability must never break the endpoint it rides on.
    logger.warn("/health extended checks failed", { error: (err as Error).message });
  }

  const reachBad = (s: string) => s !== "ok" && s !== "not_configured" && s !== "unknown";
  const degraded = !dialer.healthy || reachBad(sage) || reachBad(elevenlabs);
  res.json({
    status: degraded ? "degraded" : "ok",
    service: "frank-pilot",
    db: dbStatus,
    sage,
    elevenlabs,
    dialer,
    timestamp: new Date().toISOString(),
  });
}
