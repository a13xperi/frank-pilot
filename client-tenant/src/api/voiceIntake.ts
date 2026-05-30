import { api } from './client';

/**
 * Phase B.2 — applicant-facing voice-intake prefill.
 *
 * The "Talk to Frank" call writes a `voice_intake_calls` row keyed by the
 * ElevenLabs conversation_id. The in-call `send_app_link` tool SMSes a magic
 * link with `&intake=<conversationId>` appended. After the applicant signs in,
 * the apply wizard calls this to hydrate the form with what Frank already
 * collected on the call.
 *
 * Server contract (GET /api/voice/intakes/:conversationId/prefill, auth-
 * required): soft-404 when there's no row — the conversation_id is treated as
 * an unguessable handle and we never leak whether one existed. Callers treat
 * ANY failure (404 / 401 / network) as "no prefill" and render the blank form,
 * identical to a cold start.
 */

export interface VoicePrefill {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  currentCity: string | null;
  householdSize: number | null;
  monthlyIncome: number | null;
  consentRecording: boolean | null;
}

export interface VoicePrefillResponse {
  conversationId: string;
  language: string | null;
  prefill: VoicePrefill;
}

export async function fetchVoicePrefill(
  conversationId: string,
): Promise<VoicePrefillResponse> {
  return api.get<VoicePrefillResponse>(
    `/voice/intakes/${encodeURIComponent(conversationId)}/prefill`,
  );
}
