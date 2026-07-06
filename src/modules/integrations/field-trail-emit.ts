/**
 * Field Trail emitter — records that an onboarding EVENT happened to the Truth Token Ledger
 * (Sage `truth_tokens`). A token attests *that-it-happened* (relational, neutral), never a claim
 * of truth — see battlestation docs/TRUTH-TOKEN-NEUTRALITY.md / docs/FIELD-TRAIL.md.
 *
 * Fire-and-forget + INERT-safe (the repo's integration convention): never throws; no-ops if Sage
 * isn't configured or the table isn't applied yet (404). Inbound-only — this module records
 * events; it places NO calls/texts (no legal surface). The per-actor SEAL (sequence/entry_hash)
 * is filled downstream by battlestation; the emitter only needs to record the event.
 */
import { createHash, randomUUID } from "crypto";
import { logger } from "../../utils/logger";

export interface FieldTrailEvent {
  actor: string; // typed "kind:id" — e.g. user:<uuid> | email:<addr> | phone:<e164>
  eventType: string; // e.g. onboarding.call_placed | onboarding.text_sent | ...
  summary: string; // human-readable "what happened"
  detail?: Record<string, unknown>; // structured payload (sealed once chained)
  dependsOnTokenId?: string; // cross-actor edge (this event built on that token)
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const normalize = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");

export class FieldTrailEmitter {
  private readonly url: string | null;
  private readonly key: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    const url = process.env.SAGE_URL;
    const key = process.env.SAGE_SERVICE_ROLE_KEY || process.env.SAGE_ANON_KEY;
    this.url = url && url !== "changeme" ? url.replace(/\/+$/, "") : null;
    this.key = key && key !== "changeme" ? key : null;
    this.fetchImpl = fetchImpl;
  }

  /** Best-effort record of an event-token. Returns true iff the row was written. Never throws. */
  async emit(ev: FieldTrailEvent): Promise<boolean> {
    if (!this.url || !this.key) {
      logger.warn("field-trail: SAGE not configured — event not recorded", { eventType: ev.eventType });
      return false;
    }
    const evKey = `event:${ev.eventType}:${ev.actor}:${randomUUID()}`; // unique per occurrence
    const row = {
      query_hash: sha(normalize(evKey)),
      normalized_query: normalize(evKey),
      answer: ev.summary,
      answer_hash: sha(ev.summary),
      app: "frank-onboarding",
      event_type: ev.eventType,
      actor: ev.actor,
      event_detail: ev.detail ?? {},
      depends_on_token_id: ev.dependsOnTokenId ?? null,
      validation: "unvalidated",
      is_current: true,
    };
    try {
      const res = await this.fetchImpl(`${this.url}/rest/v1/truth_tokens`, {
        method: "POST",
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        // 404 = truth_tokens not applied yet (pre-migration) → INERT, expected.
        logger.warn("field-trail: emit non-2xx", { status: res.status, eventType: ev.eventType });
        return false;
      }
      logger.info("field-trail: event recorded", { eventType: ev.eventType });
      return true;
    } catch (err) {
      logger.error("field-trail: emit failed", {
        eventType: ev.eventType,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

let defaultInstance: FieldTrailEmitter | null = null;

export function getFieldTrailEmitter(): FieldTrailEmitter {
  if (!defaultInstance) defaultInstance = new FieldTrailEmitter();
  return defaultInstance;
}

export function __resetFieldTrailEmitterForTests(): void {
  defaultInstance = null;
}
