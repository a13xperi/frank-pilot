import { query } from "../../config/database";
import { logger } from "../../utils/logger";
import type { CallFeedbackChannel, CallFeedbackMark } from "./service";

/**
 * Training-dataset assembler (Frank core C1).
 *
 * Turns human good/bad marks (call_transcript_feedback) into a training corpus
 * by joining each mark back to its source transcript at build time:
 *   - inbound  → voice_intake_calls.raw_payload (the full ElevenLabs post-call
 *     payload, incl. transcript[]) + data_collection_results
 *   - outbound → outbound_validation_calls (we keep no transcript locally for
 *     these by design; the example carries the structured outcome + dynamic
 *     variables, which is the supervision signal for the outbound agent)
 *
 * Because the transcript is read fresh on every build, an upstream transcript
 * correction is reflected on the next refresh — the feedback row is just a
 * stable pointer + label.
 *
 * The output is provider-neutral JSONL: one DatasetExample per line. A
 * downstream fine-tune/eval job adapts these into whatever message format the
 * target model wants — we don't bake a vendor schema in here.
 *
 * Refresh modes:
 *   - full       (default) every GOOD mark (+ BAD if includeNegatives)
 *   - incremental only marks with dataset_included_at IS NULL
 * After a successful build the included rows are stamped (markIncluded), so the
 * next incremental run is a cheap WHERE on the partial index.
 */

export interface DatasetExample {
  conversationId: string;
  channel: CallFeedbackChannel;
  /** 'good' → positive example, 'bad' → negative (only present if includeNegatives). */
  label: CallFeedbackMark;
  /** Ordered transcript turns (inbound only; [] for outbound). */
  transcript: Array<{ role: string; message: string }>;
  /** Structured fields Frank extracted on the call (data_collection_results values). */
  collected: Record<string, string>;
  /** Reviewer rationale + tags — useful as eval metadata / negative reasons. */
  note: string | null;
  tags: string[];
}

export interface AssembleOptions {
  /** Also emit BAD marks as negative examples. Default false. */
  includeNegatives?: boolean;
  /** Only pull marks not yet folded into a dataset. Default false (full). */
  incrementalOnly?: boolean;
  /** Stamp the included rows' dataset_included_at after assembling. Default false. */
  markIncluded?: boolean;
}

export interface AssembleResult {
  examples: DatasetExample[];
  counts: { good: number; bad: number; total: number };
  jsonl: string;
}

interface FeedbackJoinRow {
  feedback_id: string;
  conversation_id: string;
  channel: CallFeedbackChannel;
  mark: CallFeedbackMark;
  note: string | null;
  tags: string[];
  // From the inbound source row (NULL for outbound).
  raw_payload: unknown;
  data_collection_results: Record<string, unknown> | null;
  // From the outbound source row (NULL for inbound).
  outbound_outcome: string | null;
  dynamic_variables: Record<string, unknown> | null;
}

/** Pull the value out of an ElevenLabs data_collection_results entry. */
function pickValue(
  results: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!results) return null;
  const entry = results[key];
  if (!entry || typeof entry !== "object") return null;
  const value = (entry as { value?: unknown }).value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Flatten data_collection_results into a plain {key: string} map. */
function collectFields(
  results: Record<string, unknown> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!results) return out;
  for (const key of Object.keys(results)) {
    const v = pickValue(results, key);
    if (v != null && v !== "") out[key] = v;
  }
  return out;
}

/** Extract ordered {role, message} turns from a raw ElevenLabs post-call payload. */
function transcriptFromRaw(raw: unknown): Array<{ role: string; message: string }> {
  if (!raw || typeof raw !== "object") return [];
  const turns = (raw as { transcript?: unknown }).transcript;
  if (!Array.isArray(turns)) return [];
  const out: Array<{ role: string; message: string }> = [];
  for (const t of turns) {
    if (!t || typeof t !== "object") continue;
    const role = String((t as { role?: unknown }).role ?? "").trim();
    const message = String((t as { message?: unknown }).message ?? "").trim();
    if (role && message) out.push({ role, message });
  }
  return out;
}

function buildExample(row: FeedbackJoinRow): DatasetExample {
  if (row.channel === "inbound") {
    return {
      conversationId: row.conversation_id,
      channel: "inbound",
      label: row.mark,
      transcript: transcriptFromRaw(row.raw_payload),
      collected: collectFields(row.data_collection_results),
      note: row.note,
      tags: row.tags ?? [],
    };
  }
  // Outbound: no local transcript; the structured outcome + dynamic variables
  // are the supervision signal.
  const collected: Record<string, string> = {};
  if (row.outbound_outcome) collected.outcome = row.outbound_outcome;
  if (row.dynamic_variables && typeof row.dynamic_variables === "object") {
    for (const [k, v] of Object.entries(row.dynamic_variables)) {
      if (typeof v === "string" && v) collected[k] = v;
    }
  }
  return {
    conversationId: row.conversation_id,
    channel: "outbound",
    label: row.mark,
    transcript: [],
    collected,
    note: row.note,
    tags: row.tags ?? [],
  };
}

/** Serialize examples to newline-delimited JSON (one example per line). */
export function toJsonl(examples: DatasetExample[]): string {
  return examples.map((e) => JSON.stringify(e)).join("\n");
}

export async function assembleTrainingDataset(
  opts: AssembleOptions = {}
): Promise<AssembleResult> {
  const marks: CallFeedbackMark[] = opts.includeNegatives ? ["good", "bad"] : ["good"];

  // LEFT JOIN both source tables; channel determines which side is populated.
  // We filter to the requested marks and (optionally) the not-yet-included set.
  const result = await query(
    `SELECT
        f.id          AS feedback_id,
        f.conversation_id,
        f.channel,
        f.mark,
        f.note,
        f.tags,
        vic.raw_payload,
        vic.data_collection_results,
        ovc.outcome   AS outbound_outcome,
        ovc.dynamic_variables
       FROM call_transcript_feedback f
       LEFT JOIN voice_intake_calls vic
         ON f.channel = 'inbound' AND vic.conversation_id = f.conversation_id
       LEFT JOIN outbound_validation_calls ovc
         ON f.channel = 'outbound' AND ovc.conversation_id = f.conversation_id
      WHERE f.mark = ANY($1::text[])
        AND ($2::boolean IS FALSE OR f.dataset_included_at IS NULL)
      ORDER BY f.rated_at ASC`,
    [marks, Boolean(opts.incrementalOnly)]
  );

  const rows = result.rows as FeedbackJoinRow[];
  const examples = rows.map(buildExample);

  const counts = {
    good: examples.filter((e) => e.label === "good").length,
    bad: examples.filter((e) => e.label === "bad").length,
    total: examples.length,
  };

  if (opts.markIncluded && rows.length > 0) {
    const ids = rows.map((r) => r.feedback_id);
    await query(
      `UPDATE call_transcript_feedback
          SET dataset_included_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );
  }

  logger.info("Training dataset assembled", {
    ...counts,
    incrementalOnly: Boolean(opts.incrementalOnly),
    includeNegatives: Boolean(opts.includeNegatives),
    markIncluded: Boolean(opts.markIncluded),
  });

  return { examples, counts, jsonl: toJsonl(examples) };
}
