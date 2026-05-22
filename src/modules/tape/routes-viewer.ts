/**
 * BP-02 Compliance Tape — operator viewer routes (Lane D).
 *
 * Exports a factory function so the service can be injected independently of
 * Lane B's concrete implementation. The service argument is structurally
 * typed — any object with the three methods satisfies the interface.
 *
 * All routes are operator-only (regional_manager+ via requirePermission("audit:view")).
 * Mounted under /api/compliance-tape — see src/index.ts.
 *
 * v1 scope: applicant-scoped reads only.  Global scope returns 501.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import type { TapeEntry, VerifyResult, TapeScope } from "./types";
import type {
  ListTapeResponse,
  VerifyTapeResponse,
  TapeErrorResponse,
} from "./api-contract";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Structural interface for the injected service (Lane B wires the real impl).
// Kept local so this file compiles without importing Lane B's module.
// ---------------------------------------------------------------------------

interface TapeViewerService {
  list(
    scope: TapeScope,
    opts?: { limit?: number; afterSequence?: number }
  ): Promise<TapeEntry[]>;
  verify(scope: TapeScope): Promise<VerifyResult>;
  exportPdf(scope: TapeScope): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Query-string validation schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  applicantId: z.string().uuid().optional(),
  afterSequence: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const scopedQuerySchema = z.object({
  applicantId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse applicantId from a validated query object and resolve to a TapeScope,
 *  or return a typed error to be sent as a 400/501. */
function resolveScope(
  applicantId: string | undefined
):
  | { ok: true; scope: TapeScope }
  | { ok: false; status: 400 | 501; body: TapeErrorResponse } {
  if (!applicantId) {
    // No applicantId → global scope is not implemented in v1.
    return {
      ok: false,
      status: 501,
      body: {
        error: "global scope not implemented in v1",
        code: "global_scope_not_implemented",
      },
    };
  }
  return {
    ok: true,
    scope: { type: "applicant", applicantId },
  };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** True when the service threw the "not wired" stub error. */
function isStubError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as Error & { stub?: boolean }).stub === true
  );
}

/** Send a 503 stub response — used until Phase 2 wires the real service. */
function stubUnavailable(res: Response): void {
  const body: TapeErrorResponse = {
    error: "service not yet available (Phase 2 pending)",
    code: "internal",
  };
  res.status(503).json(body);
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Create the compliance tape viewer router.
 *
 * @param service  Structurally-typed tape service. Pass the real TapeService
 *                 (Lane B) in Phase 2. Until then, a stub that returns 503 is
 *                 mounted in src/index.ts — see TODO(BP-02-Phase-2) there.
 */
export function createTapeViewerRoutes(service: TapeViewerService): Router {
  const router = Router();

  // All three routes require authentication + operator-level permission.
  router.use(authenticate, requirePermission("audit:view"));

  // -------------------------------------------------------------------------
  // GET /api/compliance-tape?applicantId=<uuid>[&afterSequence=N][&limit=N]
  // -------------------------------------------------------------------------
  router.get("/", async (req: Request, res: Response): Promise<void> => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const body: TapeErrorResponse = {
        error: "invalid query parameters",
        code: "missing_scope",
      };
      res.status(400).json(body);
      return;
    }

    const { applicantId, afterSequence, limit } = parsed.data;
    const resolution = resolveScope(applicantId);
    if (!resolution.ok) {
      res.status(resolution.status).json(resolution.body);
      return;
    }

    const { scope } = resolution;
    try {
      const entries = await service.list(scope, {
        afterSequence,
        limit: limit ?? 50,
      });

      // Determine hasMore: if we got exactly `limit` rows back, there may be more.
      const effectiveLimit = limit ?? 50;
      const hasMore = entries.length === effectiveLimit;

      const body: ListTapeResponse = {
        scope: scope as { type: "applicant"; applicantId: string },
        entries,
        hasMore,
      };
      res.status(200).json(body);
    } catch (err) {
      if (isStubError(err)) {
        stubUnavailable(res);
        return;
      }
      logger.error("compliance-tape list failed", {
        error: (err as Error).message,
        applicantId,
      });
      const body: TapeErrorResponse = {
        error: "internal error",
        code: "internal",
      };
      res.status(500).json(body);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/compliance-tape/verify?applicantId=<uuid>
  // -------------------------------------------------------------------------
  router.get("/verify", async (req: Request, res: Response): Promise<void> => {
    const parsed = scopedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const body: TapeErrorResponse = {
        error: "invalid query parameters",
        code: "missing_scope",
      };
      res.status(400).json(body);
      return;
    }

    const resolution = resolveScope(parsed.data.applicantId);
    if (!resolution.ok) {
      res.status(resolution.status).json(resolution.body);
      return;
    }

    const { scope } = resolution;
    try {
      const result: VerifyTapeResponse = await service.verify(scope);
      res.status(200).json(result);
    } catch (err) {
      if (isStubError(err)) {
        stubUnavailable(res);
        return;
      }
      logger.error("compliance-tape verify failed", {
        error: (err as Error).message,
        applicantId: parsed.data.applicantId,
      });
      const body: TapeErrorResponse = {
        error: "internal error",
        code: "internal",
      };
      res.status(500).json(body);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/compliance-tape/export.pdf?applicantId=<uuid>
  // -------------------------------------------------------------------------
  router.get(
    "/export.pdf",
    async (req: Request, res: Response): Promise<void> => {
      const parsed = scopedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        const body: TapeErrorResponse = {
          error: "invalid query parameters",
          code: "missing_scope",
        };
        res.status(400).json(body);
        return;
      }

      const resolution = resolveScope(parsed.data.applicantId);
      if (!resolution.ok) {
        res.status(resolution.status).json(resolution.body);
        return;
      }

      const { scope } = resolution;
      const { applicantId } = scope as { type: "applicant"; applicantId: string };
      try {
        const pdfBuffer = await service.exportPdf(scope);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="compliance-tape-${applicantId}.pdf"`
        );
        res.status(200).send(pdfBuffer);
      } catch (err) {
        if (isStubError(err)) {
          stubUnavailable(res);
          return;
        }
        logger.error("compliance-tape export.pdf failed", {
          error: (err as Error).message,
          applicantId,
        });
        const body: TapeErrorResponse = {
          error: "internal error",
          code: "internal",
        };
        res.status(500).json(body);
      }
    }
  );

  return router;
}
