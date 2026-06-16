/**
 * Truth Token service — mint & verify provable grounding attestations.
 *
 * A Truth Token is a PII-free receipt binding an ANSWER to the QUESTION that
 * produced it, the MODEL that generated it, and the exact SET OF SOURCE IDS the
 * answer was allowed to be grounded in. The binding is a SHA-256 over the
 * canonical JSON of {question, answer, sourceIds, modelId} (answer_hash) plus a
 * separate fingerprint of just the source set (source_set_hash). Because the
 * canonicalization is deterministic, a holder of (answer, question, sourceIds,
 * modelId) can recompute the hash and prove the answer was grounded in those
 * sources by that model — without trusting our logs.
 *
 * Canonicalization is shared with the BP-02 compliance tape (canonicalJson in
 * ../tape/hashing): sorted keys at every depth, no whitespace. Reusing it keeps
 * the digest input format auditable in one place.
 *
 * Storage is PII-minimal: only hashes + source identifiers land in the DB —
 * never the question or answer text. Everything is FAIL-CLOSED behind the
 * TRUTH_TOKEN_ENABLED flag at the route/caller seam; this service is pure logic
 * + a single INSERT, callable by tests directly.
 */

import { createHash } from "crypto";
import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import { canonicalJson } from "../tape/hashing";

/** Inputs for minting a token. `sourceIds` is the allowed source-id set the
 *  answer was grounded in (already scoped by the caller's retrieval policy). */
export interface IssueTruthTokenInput {
  question: string;
  answer: string;
  sourceIds: string[];
  modelId: string;
  engine?: string;
  createdBy: string;
  /** Optional correlation id + ledger anchor — both nullable, never block mint. */
  requestId?: string;
  ledgerHead?: string;
}

export interface TruthToken {
  id: string;
  requestId: string | null;
  answerHash: string;
  modelId: string;
  engine: string | null;
  sourceIds: string[];
  sourceSetHash: string;
  ledgerHead: string | null;
  questionHash: string | null;
  createdBy: string;
  createdAt: string;
}

export interface IssueTruthTokenResult {
  token: TruthToken;
  answer_hash: string;
}

export interface VerifyTruthTokenResult {
  hash_valid: boolean;
  sources: string[];
  model_id: string | null;
  created_at: string | null;
  /** Reserved for the ledger contradiction check (Phase 3 stub — always false). */
  ledger_contradiction: boolean;
}

// SHA-256 of a canonical-JSON value → lowercase hex.
function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Normalize a source-id set: dedupe + sort so the fingerprint is stable
 *  regardless of retrieval ordering. The canonicalReplacer does NOT reorder
 *  arrays, so we sort here to make set-equality the binding property. */
function normalizeSourceIds(sourceIds: string[]): string[] {
  return Array.from(new Set(sourceIds.map((s) => String(s)))).sort();
}

/** answer_hash binds question + answer + (normalized) sourceIds + modelId. */
function computeAnswerHash(input: {
  question: string;
  answer: string;
  sourceIds: string[];
  modelId: string;
}): string {
  return sha256Hex({
    question: input.question,
    answer: input.answer,
    sourceIds: normalizeSourceIds(input.sourceIds),
    modelId: input.modelId,
  });
}

/**
 * Mint a Truth Token for a grounded answer and persist it. Idempotent on the
 * answer_hash (same question+answer+sources+model → one canonical row): on a
 * unique-violation we re-fetch and return the existing token rather than throw,
 * so a retried request never errors.
 */
export async function issueTruthToken(
  input: IssueTruthTokenInput
): Promise<IssueTruthTokenResult> {
  const sources = normalizeSourceIds(input.sourceIds);
  const answerHash = computeAnswerHash({
    question: input.question,
    answer: input.answer,
    sourceIds: sources,
    modelId: input.modelId,
  });
  const sourceSetHash = sha256Hex(sources);
  const questionHash = sha256Hex(input.question);

  const res = await query(
    `INSERT INTO truth_tokens
       (request_id, answer_hash, model_id, engine, source_ids,
        source_set_hash, ledger_head, question_hash, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     ON CONFLICT (answer_hash) DO NOTHING
     RETURNING *`,
    [
      input.requestId ?? null,
      answerHash,
      input.modelId,
      input.engine ?? null,
      JSON.stringify(sources),
      sourceSetHash,
      input.ledgerHead ?? null,
      questionHash,
      input.createdBy,
    ]
  );

  let row = res.rows[0];
  if (!row) {
    // Lost the ON CONFLICT race / already minted — re-fetch the canonical row.
    const existing = await query(
      `SELECT * FROM truth_tokens WHERE answer_hash = $1`,
      [answerHash]
    );
    row = existing.rows[0];
  }

  logger.info("truth-token issued", {
    answerHash,
    sourceSetHash,
    modelId: input.modelId,
    createdBy: input.createdBy,
    sourceCount: sources.length,
  });

  return { token: rowToToken(row), answer_hash: answerHash };
}

/**
 * Verify a token by answer_hash: fetch the stored row, recompute the source-set
 * fingerprint from the persisted source ids, and report whether the stored
 * answer_hash is internally consistent. We cannot recompute answer_hash itself
 * (the question/answer text is intentionally NOT stored) — so hash_valid asserts
 * the source_set_hash still matches the persisted source_ids, i.e. the row hasn't
 * been tampered with. Returns PII-free fields only.
 */
export async function verifyTruthToken(
  answerHash: string
): Promise<VerifyTruthTokenResult> {
  const res = await query(`SELECT * FROM truth_tokens WHERE answer_hash = $1`, [
    answerHash,
  ]);
  const row = res.rows[0];
  if (!row) {
    return {
      hash_valid: false,
      sources: [],
      model_id: null,
      created_at: null,
      ledger_contradiction: false,
    };
  }

  const token = rowToToken(row);
  const recomputed = sha256Hex(normalizeSourceIds(token.sourceIds));
  const hashValid = recomputed === token.sourceSetHash;

  return {
    hash_valid: hashValid,
    sources: token.sourceIds,
    model_id: token.modelId,
    created_at: token.createdAt,
    // Phase 3 stub: ledger contradiction detection lands when the verify
    // surface cross-checks ledger_head against the live compliance-tape head.
    ledger_contradiction: false,
  };
}

// Map a DB row to the TruthToken shape. source_ids is jsonb (already parsed by
// pg into a JS value); coerce defensively to a string[].
function rowToToken(row: Record<string, unknown>): TruthToken {
  const raw = row.source_ids;
  const sourceIds = Array.isArray(raw)
    ? (raw as unknown[]).map((s) => String(s))
    : [];
  return {
    id: String(row.id),
    requestId: row.request_id === null ? null : String(row.request_id),
    answerHash: String(row.answer_hash),
    modelId: String(row.model_id),
    engine: row.engine === null ? null : String(row.engine),
    sourceIds,
    sourceSetHash: String(row.source_set_hash),
    ledgerHead: row.ledger_head === null ? null : String(row.ledger_head),
    questionHash: row.question_hash === null ? null : String(row.question_hash),
    createdBy: String(row.created_by),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

// Test-only re-export of the hash binding so the canonicalization can be
// exercised directly (tampered-answer assertions) without an INSERT.
export const __test = { computeAnswerHash, normalizeSourceIds };
