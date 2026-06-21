import { query } from "../../config/database";

/**
 * NO-PII inbound voice metrics for the token-watch Frank cockpit.
 *
 * Every field is an aggregate COUNT — never a name, phone, transcript, or any
 * applicant row. Sourced from voice_intake_calls on frank-pilot's own DB (the
 * inbound figures the cockpit's Sage REST project cannot see).
 */
export interface InboundMetrics {
  generated_at: string;
  total_calls: number;
  last_24h: number;
  last_7d: number;
  promoted: number; // intakes promoted to an application (applicant_id set)
  callbacks_requested: number;
  awaiting_review: number; // un-promoted, no callback — still in the triage queue
  completed: number; // call_successful = 'success'
  no_consent: number; // consent_recording = false
  answer_rate: number; // completed / total_calls, 0..1
}

const METRICS_SQL = `
  SELECT
    COUNT(*)::int                                                                    AS total_calls,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int           AS last_24h,
    COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int             AS last_7d,
    COUNT(*) FILTER (WHERE applicant_id IS NOT NULL)::int                            AS promoted,
    COUNT(*) FILTER (WHERE callback_requested = true)::int                           AS callbacks_requested,
    COUNT(*) FILTER (WHERE applicant_id IS NULL AND callback_requested = false)::int AS awaiting_review,
    COUNT(*) FILTER (WHERE call_successful = 'success')::int                         AS completed,
    COUNT(*) FILTER (WHERE consent_recording = false)::int                           AS no_consent
  FROM voice_intake_calls
`;

export class CockpitMetricsService {
  async getInboundMetrics(): Promise<InboundMetrics> {
    const res = await query(METRICS_SQL);
    const r = (res.rows[0] ?? {}) as Record<string, number>;
    const total = Number(r.total_calls ?? 0);
    const completed = Number(r.completed ?? 0);
    return {
      generated_at: new Date().toISOString(),
      total_calls: total,
      last_24h: Number(r.last_24h ?? 0),
      last_7d: Number(r.last_7d ?? 0),
      promoted: Number(r.promoted ?? 0),
      callbacks_requested: Number(r.callbacks_requested ?? 0),
      awaiting_review: Number(r.awaiting_review ?? 0),
      completed,
      no_consent: Number(r.no_consent ?? 0),
      answer_rate: total ? Math.round((completed / total) * 1000) / 1000 : 0,
    };
  }
}

export const cockpitMetricsService = new CockpitMetricsService();
