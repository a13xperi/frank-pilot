/**
 * BP-02 Compliance Tape — Postgres repository.
 *
 * Implements TapeRepository against the `compliance_tape` table defined in
 * docs/bp-02-contracts.md §2. prev_hash / entry_hash are stored as BYTEA in
 * Postgres; this boundary converts to/from hex strings (TapeEntry uses hex).
 *
 * All three methods run inside a single transaction (BEGIN/COMMIT) via the
 * `transaction` helper from config/database.
 */

import { transaction } from "../../config/database";
import type { TapeEntry, TapeRepository, TapeScope } from "./types";

// ---------------------------------------------------------------------------
// Row ↔ domain mapping
// ---------------------------------------------------------------------------

function rowToEntry(row: Record<string, unknown>): TapeEntry {
  return {
    id: row.id as string,
    sequence: Number(row.sequence),
    kind: row.kind as TapeEntry["kind"],
    citation: row.citation as string,
    applicantId: (row.applicant_id as string | null) ?? null,
    propertyId: (row.property_id as string | null) ?? null,
    payload: row.payload as TapeEntry["payload"],
    prevHash: (row.prev_hash as Buffer).toString("hex"),
    entryHash: (row.entry_hash as Buffer).toString("hex"),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at as string),
    sessionId: (row.session_id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// WHERE clause helpers
// ---------------------------------------------------------------------------

function scopeWhere(
  scope: TapeScope,
  paramOffset: number = 1
): { sql: string; param: string | null } {
  if (scope.type === "applicant") {
    return {
      sql: `applicant_id = $${paramOffset}`,
      param: scope.applicantId,
    };
  }
  if (scope.type === "property") {
    return {
      sql: `property_id = $${paramOffset}`,
      param: scope.propertyId,
    };
  }
  // global scope — neither applicant nor property
  return { sql: "applicant_id IS NULL AND property_id IS NULL", param: null };
}

// ---------------------------------------------------------------------------
// PgTapeRepository
// ---------------------------------------------------------------------------

export class PgTapeRepository implements TapeRepository {
  /**
   * Append a new row.  The caller has already computed sequence + both hashes.
   * BYTEA columns receive the raw Buffer from hex conversion.
   */
  async insert(
    row: Omit<TapeEntry, "id" | "createdAt"> & { createdAt: string }
  ): Promise<TapeEntry> {
    return transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO compliance_tape
           (applicant_id, property_id, sequence, kind, citation, payload,
            prev_hash, entry_hash, session_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (kind, session_id) DO NOTHING
         RETURNING *`,
        [
          row.applicantId ?? null,
          row.propertyId ?? null,
          row.sequence,
          row.kind,
          row.citation,
          row.payload,
          Buffer.from(row.prevHash, "hex"),
          Buffer.from(row.entryHash, "hex"),
          row.sessionId ?? null,
          row.createdAt,
        ]
      );

      if (result.rows.length === 0) {
        // Idempotent: row already exists — fetch the original via (kind, session_id)
        const existing = await client.query(
          `SELECT * FROM compliance_tape
           WHERE kind = $1 AND session_id = $2
           LIMIT 1`,
          [row.kind, row.sessionId ?? null]
        );
        return rowToEntry(existing.rows[0] as Record<string, unknown>);
      }

      return rowToEntry(result.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Most recent entry in scope (by sequence DESC), or null if scope is empty.
   * Used by stamp() to seed prevHash + next sequence.
   */
  async tail(scope: TapeScope): Promise<TapeEntry | null> {
    return transaction(async (client) => {
      const { sql, param } = scopeWhere(scope);
      const params: (string | null)[] = param !== null ? [param] : [];

      const result = await client.query(
        `SELECT * FROM compliance_tape
         WHERE ${sql}
         ORDER BY sequence DESC
         LIMIT 1`,
        params
      );

      if (result.rows.length === 0) return null;
      return rowToEntry(result.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Read entries in scope, oldest-first.  Supports pagination via
   * opts.afterSequence and a hard cap of opts.limit (default 1000).
   */
  async list(
    scope: TapeScope,
    opts?: { limit?: number; afterSequence?: number }
  ): Promise<TapeEntry[]> {
    return transaction(async (client) => {
      const limit = opts?.limit ?? 1000;
      const conditions: string[] = [];
      const params: (string | number | null)[] = [];

      const { sql: scopeSql, param: scopeParam } = scopeWhere(scope, 1);
      conditions.push(scopeSql);
      if (scopeParam !== null) params.push(scopeParam);

      if (opts?.afterSequence !== undefined) {
        params.push(opts.afterSequence);
        conditions.push(`sequence > $${params.length}`);
      }

      const where = conditions.join(" AND ");

      const result = await client.query(
        `SELECT * FROM compliance_tape
         WHERE ${where}
         ORDER BY sequence ASC
         LIMIT ${limit}`,
        params
      );

      return result.rows.map((r) => rowToEntry(r as Record<string, unknown>));
    });
  }
}
