/**
 * BP-02 Compliance Tape — HTTP API contract.
 *
 * Contract file: Lane D implements these routes; Lane E (operator AuditLog
 * viewer) calls them. Lane F's smoke replays them against a mock service.
 *
 * All routes are operator-only (existing `hasMinRole('operator')` middleware).
 * Mounted under /api/compliance-tape.
 */
import type { TapeEntry, VerifyResult } from "./types";

/* --------------------------------------------------------------------- *
 *  GET /api/compliance-tape
 *  List entries in a scope. v1 supports applicant scope only; passing
 *  neither applicantId nor `scope=global` is a 400.
 * --------------------------------------------------------------------- */
export interface ListTapeQuery {
  /** Required for v1 — `global` returns 501. */
  applicantId?: string;
  /** Pagination cursor: only return entries with sequence > afterSequence. */
  afterSequence?: number;
  /** Hard cap 200 per page; default 50. */
  limit?: number;
}

export interface ListTapeResponse {
  scope: { type: "applicant"; applicantId: string };
  entries: TapeEntry[];
  /** Whether more rows exist past the last returned sequence. */
  hasMore: boolean;
}

/* --------------------------------------------------------------------- *
 *  GET /api/compliance-tape/verify
 *  Recompute the hash chain and return ok/brokeAt.
 * --------------------------------------------------------------------- */
export interface VerifyTapeQuery {
  /** Required for v1 — `global` returns 501. */
  applicantId?: string;
}

export type VerifyTapeResponse = VerifyResult;

/* --------------------------------------------------------------------- *
 *  GET /api/compliance-tape/export.pdf
 *  Binary response — `application/pdf` with `Content-Disposition: attachment`.
 *  Body: every entry rendered as one row, footer per page with the rolling
 *  SHA-256 hash so paper output is self-verifying.
 * --------------------------------------------------------------------- */
export interface ExportPdfTapeQuery {
  /** Required for v1 — `global` returns 501. */
  applicantId?: string;
}

/* --------------------------------------------------------------------- *
 *  Standard error envelope. Routes return this on 400/403/404/501/500.
 * --------------------------------------------------------------------- */
export interface TapeErrorResponse {
  error: string;
  /** Stable machine code: `missing_scope`, `forbidden`, `not_found`,
   *  `global_scope_not_implemented`, `verify_failed`, `internal`. */
  code:
    | "missing_scope"
    | "forbidden"
    | "not_found"
    | "global_scope_not_implemented"
    | "verify_failed"
    | "internal";
  /** Only set for verify_failed — surfaces brokeAt to the client. */
  brokeAt?: number;
}

/** Stable URL paths — single source of truth for both routes and the viewer. */
export const TAPE_API_PATHS = {
  list: "/api/compliance-tape",
  verify: "/api/compliance-tape/verify",
  exportPdf: "/api/compliance-tape/export.pdf",
} as const;
