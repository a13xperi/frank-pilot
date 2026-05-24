/**
 * QA debug-bundle viewer — operator-side routes.
 *
 * The tenant app's ScreenshotButton (client-tenant/src/components/dev/ScreenshotButton.tsx)
 * uploads three artifacts per capture to the `frank-qa-screenshots` Supabase
 * Storage bucket: `frank-{slug}-{YYYYMMDD-HHMMSS}.{png|json|replay.json}`. These
 * endpoints list and resolve those bundles for the operator UI.
 *
 * Auth: `audit:view` — same gate as /api/audit, so any role that can read the
 * audit log can read QA bundles.
 *
 * SECURITY (post-#103 audit, this PR):
 * The list/detail endpoints return public bucket URLs for backwards-compat
 * during rollout, but the operator UI now fetches artifact bytes via the
 * three streaming proxy endpoints below (`/bundles/:stem/png`,
 * `/bundles/:stem/sidecar`, `/bundles/:stem/replay`). Each proxy is gated by
 * `authenticate` + `requirePermission("audit:view")` and writes a
 * `qa_bundle_read` audit log entry on success.
 *
 * After this PR lands, the `frank-qa-screenshots` bucket SHOULD be set to
 * private. Until that ops change happens, the new endpoints work but the old
 * public URLs are still accessible directly. Both paths coexist for the
 * rollback window. Track bucket privatization as a separate ops follow-up.
 *
 * The grouping and stem-parsing logic is pure and exported for unit tests.
 */

import { Router, Request, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { writeAuditLog } from "../../middleware/audit";
import { logger } from "../../utils/logger";

export const QA_BUCKET = "frank-qa-screenshots";
const MAX_BUNDLES = 50;
const STORAGE_LIST_LIMIT = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorageObject {
  name: string;
  created_at?: string | null;
}

export interface BundleSummary {
  stem: string;
  slug: string;
  capturedAt: string; // ISO-8601 (no timezone — recorded as the capture client's local clock)
  urls: {
    png: string | null;
    json: string;
    replay: string | null;
  };
}

interface ListBundlesResponse {
  bundles: BundleSummary[];
  hint?: string;
}

interface BundleResponse {
  bundle: BundleSummary;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse `frank-{slug}-{YYYYMMDD}-{HHMMSS}` into its parts. The slug may
 * itself contain hyphens (e.g. `dashboard-overview`), so we anchor on the
 * trailing `-{8 digits}-{6 digits}` timestamp signature.
 */
export function parseStem(
  stem: string
): { slug: string; capturedAt: string } | null {
  const m = stem.match(/^frank-(.+)-(\d{8})-(\d{6})$/);
  if (!m) return null;
  const [, slug, date, time] = m;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
  return { slug, capturedAt: iso };
}

interface SplitName {
  stem: string;
  kind: "png" | "json" | "replay";
}

/** Classify a storage object's filename. Returns null if it isn't one of ours. */
export function splitName(name: string): SplitName | null {
  if (name.endsWith(".replay.json")) {
    return { stem: name.slice(0, -".replay.json".length), kind: "replay" };
  }
  if (name.endsWith(".json")) {
    return { stem: name.slice(0, -".json".length), kind: "json" };
  }
  if (name.endsWith(".png")) {
    return { stem: name.slice(0, -".png".length), kind: "png" };
  }
  return null;
}

/**
 * Group raw storage listings into bundles. Drops any group missing the JSON
 * sidecar (capture failed mid-flight, useless to the operator), and sorts by
 * capturedAt desc. Caller decides how many to return.
 */
export function groupBundles(
  items: StorageObject[],
  publicUrlBase: string
): BundleSummary[] {
  const byStem = new Map<
    string,
    { png?: string; json?: string; replay?: string }
  >();

  for (const it of items) {
    const split = splitName(it.name);
    if (!split) continue;
    const entry = byStem.get(split.stem) ?? {};
    entry[split.kind] = `${publicUrlBase}/${it.name}`;
    byStem.set(split.stem, entry);
  }

  const out: BundleSummary[] = [];
  for (const [stem, files] of byStem.entries()) {
    if (!files.json) continue; // sidecar is mandatory
    const parsed = parseStem(stem);
    if (!parsed) continue;
    out.push({
      stem,
      slug: parsed.slug,
      capturedAt: parsed.capturedAt,
      urls: {
        png: files.png ?? null,
        json: files.json,
        replay: files.replay ?? null,
      },
    });
  }

  out.sort((a, b) =>
    a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0
  );

  return out;
}

// ---------------------------------------------------------------------------
// Demo/usability sessions
//
// The tenant app's demo harness (client-tenant/src/lib/demoCapture.ts) uploads
// full-session artifacts under `demo/{runId}/`:
//   - replay-{seq:000}.json  — ordered rrweb segments (concatenate in seq order)
//   - events.json            — funnel "step-entered" + "stuck" markers
//   - manifest.json          — run metadata (start time, ua, route, counts)
// runId is minted client-side (lib/demoSession): `r{base36-time}-{rand}`.
// ---------------------------------------------------------------------------

export const DEMO_PREFIX = "demo/";

/** runId shape — `r{base36}-{base36}`. Anchored to reject path-traversal. */
export const RUN_ID_RE = /^r[a-z0-9]+-[a-z0-9]+$/i;

/** The only filenames the proxy will serve out of a demo run folder. */
export const DEMO_FILE_RE = /^(replay-\d{1,6}\.json|events\.json|manifest\.json)$/;

export interface DemoRunDetail {
  runId: string;
  segments: string[]; // object names (relative to the run folder), seq-ascending
  events: string | null;
  manifest: string | null;
}

function segOf(name: string): number {
  const m = name.match(/^replay-(\d+)\.json$/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * Classify the files found directly under one `demo/{runId}/` folder. `names`
 * are the leaf filenames (no folder prefix). Replay segments are returned in
 * ascending sequence order so the viewer can concatenate them into one timeline.
 */
export function classifyDemoFiles(names: string[]): Omit<DemoRunDetail, "runId"> {
  const segments = names
    .filter((n) => /^replay-\d+\.json$/.test(n))
    .sort((a, b) => segOf(a) - segOf(b));
  return {
    segments,
    events: names.includes("events.json") ? "events.json" : null,
    manifest: names.includes("manifest.json") ? "manifest.json" : null,
  };
}

// ---------------------------------------------------------------------------
// Storage fetch (server → Supabase REST)
// ---------------------------------------------------------------------------

interface StorageEnv {
  url: string;
  key: string;
  bucket: string;
}

function readStorageEnv(): StorageEnv | null {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    "";
  if (!url || !key) return null;
  return { url, key, bucket: QA_BUCKET };
}

async function listStorage(
  env: StorageEnv,
  opts: { prefix?: string; limit?: number } = {}
): Promise<StorageObject[]> {
  const res = await fetch(
    `${env.url}/storage/v1/object/list/${env.bucket}`,
    {
      method: "POST",
      headers: {
        apikey: env.key,
        Authorization: `Bearer ${env.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        limit: opts.limit ?? STORAGE_LIST_LIMIT,
        prefix: opts.prefix ?? "",
        sortBy: { column: "created_at", order: "desc" },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Storage list failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("Storage list response was not an array");
  }
  return body as StorageObject[];
}

function publicUrlBase(env: StorageEnv): string {
  return `${env.url}/storage/v1/object/public/${env.bucket}`;
}

// ---------------------------------------------------------------------------
// Server-proxy: fetch object bytes from Supabase Storage with the service-role
// key, so the bucket can be flipped to private without breaking the viewer.
// ---------------------------------------------------------------------------

/** Map the artifact kind to its on-disk filename suffix in the bucket. */
const ARTIFACT_SUFFIX: Record<"png" | "sidecar" | "replay", string> = {
  png: ".png",
  sidecar: ".json",
  replay: ".replay.json",
};

const ARTIFACT_CONTENT_TYPE: Record<"png" | "sidecar" | "replay", string> = {
  png: "image/png",
  sidecar: "application/json",
  replay: "application/json",
};

/**
 * Fetch a single object's bytes from the Supabase Storage REST API using the
 * authenticated (service-role) endpoint. Works whether the bucket is public
 * or private.
 *
 * Returns null when the object is missing (404) so the caller can map to a
 * clean 404 response. Throws for transport / 5xx failures.
 */
export async function fetchStorageObject(
  env: StorageEnv,
  objectName: string
): Promise<{
  body: ArrayBuffer;
  contentType: string | null;
} | null> {
  const res = await fetch(
    `${env.url}/storage/v1/object/${env.bucket}/${encodeURIComponent(objectName)}`,
    {
      method: "GET",
      headers: {
        apikey: env.key,
        Authorization: `Bearer ${env.key}`,
      },
    }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Storage fetch failed (${res.status}): ${detail.slice(0, 200)}`
    );
  }
  const buf = await res.arrayBuffer();
  return { body: buf, contentType: res.headers.get("content-type") };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function qaRouter(): Router {
  const router = Router();

  router.use(authenticate, requirePermission("audit:view"));

  router.get("/bundles", async (_req: Request, res: Response) => {
    const env = readStorageEnv();
    if (!env) {
      const body: ListBundlesResponse = {
        bundles: [],
        hint:
          "Supabase Storage is not configured on this server — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable the QA viewer.",
      };
      res.json(body);
      return;
    }
    try {
      const items = await listStorage(env);
      const grouped = groupBundles(items, publicUrlBase(env));
      const body: ListBundlesResponse = {
        bundles: grouped.slice(0, MAX_BUNDLES),
      };
      res.json(body);
    } catch (err) {
      logger.error("QA bundle list failed", {
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to list QA bundles" });
    }
  });

  /**
   * Internal: build a streaming-proxy handler for one artifact kind. Each
   * call gates on the stem regex, fetches the object via the service-role
   * Supabase endpoint, writes a `qa_bundle_read` audit entry on success, and
   * streams the bytes back with the appropriate Content-Type.
   */
  function makeArtifactHandler(kind: "png" | "sidecar" | "replay") {
    return async (req: AuthRequest, res: Response): Promise<void> => {
      const env = readStorageEnv();
      if (!env) {
        res.status(503).json({
          error:
            "Supabase Storage is not configured on this server — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        });
        return;
      }
      const raw = req.params.stem;
      const stem = Array.isArray(raw) ? raw[0] : raw;
      if (typeof stem !== "string" || !parseStem(stem)) {
        res.status(400).json({ error: "Malformed bundle stem" });
        return;
      }
      const objectName = `${stem}${ARTIFACT_SUFFIX[kind]}`;
      try {
        const obj = await fetchStorageObject(env, objectName);
        if (!obj) {
          res.status(404).json({ error: "Bundle artifact not found" });
          return;
        }

        // Audit FIRST — if the DB write fails, we don't want to silently leak
        // bytes to the client. writeAuditLog throws on failure.
        await writeAuditLog({
          action: "qa_bundle_read",
          actorId: req.user?.id,
          actorRole: req.user?.role,
          resourceType: "qa_bundle",
          // resource_id is a UUID column; the bundle stem isn't one, so carry
          // the identifier in details (JSONB) instead of resourceId.
          details: { artifact: kind, bundle: stem },
          ipAddress: (req.ip || req.socket.remoteAddress) as string | undefined,
          userAgent: req.headers["user-agent"] as string | undefined,
        });

        res.setHeader(
          "Content-Type",
          obj.contentType ?? ARTIFACT_CONTENT_TYPE[kind]
        );
        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).send(Buffer.from(obj.body));
      } catch (err) {
        logger.error("QA bundle artifact proxy failed", {
          stem,
          artifact: kind,
          error: (err as Error).message,
        });
        res.status(500).json({ error: "Failed to fetch QA bundle artifact" });
      }
    };
  }

  router.get("/bundles/:stem/png", makeArtifactHandler("png"));
  router.get("/bundles/:stem/sidecar", makeArtifactHandler("sidecar"));
  router.get("/bundles/:stem/replay", makeArtifactHandler("replay"));

  router.get("/bundles/:stem", async (req: Request, res: Response) => {
    const env = readStorageEnv();
    if (!env) {
      res.status(503).json({
        error:
          "Supabase Storage is not configured on this server — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }
    const raw = req.params.stem;
    const stem = Array.isArray(raw) ? raw[0] : raw;
    if (typeof stem !== "string" || !parseStem(stem)) {
      res.status(400).json({ error: "Malformed bundle stem" });
      return;
    }
    try {
      const items = await listStorage(env);
      const match = items.filter((it) => {
        const split = splitName(it.name);
        return split && split.stem === stem;
      });
      const grouped = groupBundles(match, publicUrlBase(env));
      if (grouped.length === 0) {
        res.status(404).json({ error: "Bundle not found" });
        return;
      }
      const body: BundleResponse = { bundle: grouped[0] };
      res.json(body);
    } catch (err) {
      logger.error("QA bundle fetch failed", {
        stem,
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to fetch QA bundle" });
    }
  });

  // -------------------------------------------------------------------------
  // Demo/usability sessions
  // -------------------------------------------------------------------------

  /**
   * List demo runs. One storage call enumerates the `demo/` folder (Supabase
   * returns each `{runId}` as a folder pseudo-entry); we keep only well-formed
   * runIds. Cheap by design — segment counts and timelines are loaded lazily
   * by the detail endpoint.
   */
  router.get("/demo", async (_req: Request, res: Response) => {
    const env = readStorageEnv();
    if (!env) {
      res.json({
        runs: [],
        hint:
          "Supabase Storage is not configured on this server — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable the demo viewer.",
      });
      return;
    }
    try {
      const items = await listStorage(env, { prefix: DEMO_PREFIX });
      const runs = items
        .map((it) => it.name)
        .filter((name) => RUN_ID_RE.test(name))
        .slice(0, MAX_BUNDLES)
        .map((runId) => ({ runId }));
      res.json({ runs });
    } catch (err) {
      logger.error("Demo run list failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to list demo runs" });
    }
  });

  /** Detail for one run: ordered replay segments + events + manifest names. */
  router.get("/demo/:runId", async (req: Request, res: Response) => {
    const env = readStorageEnv();
    if (!env) {
      res.status(503).json({
        error:
          "Supabase Storage is not configured on this server — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }
    const raw = req.params.runId;
    const runId = Array.isArray(raw) ? raw[0] : raw;
    if (typeof runId !== "string" || !RUN_ID_RE.test(runId)) {
      res.status(400).json({ error: "Malformed run id" });
      return;
    }
    try {
      const items = await listStorage(env, { prefix: `${DEMO_PREFIX}${runId}/` });
      const detail: DemoRunDetail = {
        runId,
        ...classifyDemoFiles(items.map((it) => it.name)),
      };
      if (detail.segments.length === 0 && !detail.events && !detail.manifest) {
        res.status(404).json({ error: "Demo run not found" });
        return;
      }
      res.json({ run: detail });
    } catch (err) {
      logger.error("Demo run fetch failed", {
        runId,
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to fetch demo run" });
    }
  });

  /**
   * Stream one artifact (`replay-NNN.json` | `events.json` | `manifest.json`)
   * out of a run folder via the service-role key, so the bucket can be
   * private. Both path segments are regex-validated to block traversal, and a
   * `qa_bundle_read` audit entry is written before any bytes are returned.
   */
  router.get(
    "/demo/:runId/file/:name",
    async (req: AuthRequest, res: Response): Promise<void> => {
      const env = readStorageEnv();
      if (!env) {
        res.status(503).json({
          error:
            "Supabase Storage is not configured on this server — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        });
        return;
      }
      const rawRun = req.params.runId;
      const rawName = req.params.name;
      const runId = Array.isArray(rawRun) ? rawRun[0] : rawRun;
      const name = Array.isArray(rawName) ? rawName[0] : rawName;
      if (
        typeof runId !== "string" ||
        !RUN_ID_RE.test(runId) ||
        typeof name !== "string" ||
        !DEMO_FILE_RE.test(name)
      ) {
        res.status(400).json({ error: "Malformed demo artifact path" });
        return;
      }
      const objectName = `${DEMO_PREFIX}${runId}/${name}`;
      try {
        const obj = await fetchStorageObject(env, objectName);
        if (!obj) {
          res.status(404).json({ error: "Demo artifact not found" });
          return;
        }
        // Audit FIRST — never leak bytes if the audit write fails.
        await writeAuditLog({
          action: "qa_bundle_read",
          actorId: req.user?.id,
          actorRole: req.user?.role,
          resourceType: "qa_bundle",
          // resource_id is a UUID column; the runId isn't one, so carry the
          // identifier in details (JSONB) instead of resourceId.
          details: { artifact: name, runId },
          ipAddress: (req.ip || req.socket.remoteAddress) as string | undefined,
          userAgent: req.headers["user-agent"] as string | undefined,
        });
        res.setHeader("Content-Type", obj.contentType ?? "application/json");
        res.setHeader("Cache-Control", "private, no-store");
        res.status(200).send(Buffer.from(obj.body));
      } catch (err) {
        logger.error("Demo artifact proxy failed", {
          runId,
          name,
          error: (err as Error).message,
        });
        res.status(500).json({ error: "Failed to fetch demo artifact" });
      }
    }
  );

  return router;
}
