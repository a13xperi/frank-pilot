/**
 * QA debug-bundle viewer — operator-side routes.
 *
 * The tenant app's ScreenshotButton (client-tenant/src/components/dev/ScreenshotButton.tsx)
 * uploads three artifacts per capture to the public `frank-qa-screenshots` Supabase
 * Storage bucket: `frank-{slug}-{YYYYMMDD-HHMMSS}.{png|json|replay.json}`. These
 * endpoints list and resolve those bundles for the operator UI.
 *
 * Auth: `audit:view` — same gate as /api/audit, so any role that can read the
 * audit log can read QA bundles.
 *
 * The grouping and stem-parsing logic is pure and exported for unit tests.
 */

import { Router, Request, Response } from "express";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
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
  env: StorageEnv
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
        limit: STORAGE_LIST_LIMIT,
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

  return router;
}
