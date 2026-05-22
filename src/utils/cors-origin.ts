/**
 * Boot-time CORS allow-list resolution.
 *
 * #99 follow-up (HIGH-2, SECURITY-AUDIT-2026-05-21): the original fix threw
 * unconditionally when CORS_ORIGIN was unset, crashing `npm start` in local
 * dev. Mirror the NODE_ENV gate used for JWT_SECRET / ENCRYPTION_KEY in
 * src/index.ts: fail-closed in production, fall back to localhost in dev/test.
 *
 * Staging must set CORS_ORIGIN explicitly via Railway env — see .env.example.
 */
export function resolveCorsOrigin(env: NodeJS.ProcessEnv): string[] {
  const raw = env.CORS_ORIGIN?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (env.NODE_ENV === "production") {
    throw new Error("CORS_ORIGIN is required in production (no wildcard fallback)");
  }
  // Dev/test default: Vite dev server (5174) + API self-origin (3000).
  return ["http://localhost:5174", "http://localhost:3000"];
}
