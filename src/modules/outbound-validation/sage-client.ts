import { logger } from "../../utils/logger";

/**
 * Thin PostgREST client for the GPM waitlist source of truth on the Sage
 * Supabase project (gpm_waitlist_applicants / gpm_validation_calls).
 *
 * Deliberately NOT @supabase/supabase-js: two RPCs and two reads don't earn a
 * dependency, and plain fetch keeps the auth surface explicit. The tables are
 * RLS-enabled with no policies, so every call here MUST carry the service-role
 * key — these env vars are distinct from SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY,
 * which belong to the QA-storage project.
 *
 * Contract (see battlestation schema/gpm-waitlist-sot.sql):
 *   gpm_claim_next_call(p_agent)  -> atomically claims next applicant (or none)
 *   gpm_record_call_outcome(...)  -> logs attempt + advances the state machine
 */

export interface SageApplicant {
  id: string;
  full_name: string;
  phone_e164: string | null;
  phone_display: string | null;
  phone_shared_with: string | null;
  properties: string[];
  first_added: string;
  date_needed: string | null;
  asap: boolean;
  apt_types: string[];
  call_status: string;
  call_attempts: number;
  still_interested: boolean | null;
  last_call_at: string | null;
  call_notes: string | null;
}

export interface SageValidationCall {
  id: string;
  applicant_id: string;
  called_at: string;
  agent: string;
  outcome: string;
  still_interested: boolean | null;
  notes: string | null;
}

export type GpmOutcome =
  | "confirmed"
  | "declined"
  | "no_answer"
  | "voicemail"
  | "bad_number"
  | "callback_requested";

function sageUrl(): string {
  return (process.env.GPM_SUPABASE_URL ?? "").replace(/\/$/, "");
}

function sageKey(): string {
  return process.env.GPM_SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function isSageConfigured(): boolean {
  return Boolean(sageUrl() && sageKey());
}

async function sageFetch(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  if (!isSageConfigured()) {
    throw new Error("Sage waitlist client not configured (GPM_SUPABASE_URL / GPM_SUPABASE_SERVICE_ROLE_KEY)");
  }
  const res = await fetch(`${sageUrl()}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: sageKey(),
      Authorization: `Bearer ${sageKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Sage ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  return res;
}

/** Atomically claim the next applicant in fair order. Null when queue is empty. */
export async function claimNextCall(agent = "frank"): Promise<SageApplicant | null> {
  const res = await sageFetch("rpc/gpm_claim_next_call", {
    method: "POST",
    body: { p_agent: agent },
  });
  const rows = (await res.json()) as SageApplicant[];
  return rows[0] ?? null;
}

/** Log one call attempt and advance the applicant's state machine. */
export async function recordCallOutcome(args: {
  applicantId: string;
  outcome: GpmOutcome;
  stillInterested?: boolean | null;
  notes?: string | null;
  agent?: string;
}): Promise<void> {
  await sageFetch("rpc/gpm_record_call_outcome", {
    method: "POST",
    body: {
      p_applicant_id: args.applicantId,
      p_outcome: args.outcome,
      p_still_interested: args.stillInterested ?? null,
      p_notes: args.notes ?? null,
      p_agent: args.agent ?? "frank",
    },
  });
}

/**
 * Release a claim without consuming an attempt (dry-run path). A claimed
 * callback_requested row goes back to plain pending — queue position is
 * unaffected (ordering is asap/first_added), only the label is lost.
 */
export async function resetClaim(applicantId: string): Promise<void> {
  await sageFetch(
    `gpm_waitlist_applicants?id=eq.${encodeURIComponent(applicantId)}&call_status=eq.in_progress`,
    { method: "PATCH", body: { call_status: "pending" }, headers: { Prefer: "return=minimal" } }
  );
}

/** Depth of the live call queue (gpm_next_to_call view). */
export async function queueDepth(): Promise<number> {
  const res = await sageFetch("gpm_next_to_call?select=id", {
    headers: { Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

/** Full roster — 62 rows, fine to aggregate in process. */
export async function listApplicants(): Promise<SageApplicant[]> {
  const res = await sageFetch(
    "gpm_waitlist_applicants?select=*&order=asap.desc,first_added.asc&limit=1000"
  );
  return (await res.json()) as SageApplicant[];
}

/** Per-attempt call log, newest first. */
export async function listValidationCalls(): Promise<SageValidationCall[]> {
  const res = await sageFetch(
    "gpm_validation_calls?select=id,applicant_id,called_at,agent,outcome,still_interested,notes&order=called_at.desc&limit=2000"
  );
  return (await res.json()) as SageValidationCall[];
}

export function logSageError(context: string, err: unknown): void {
  logger.error(`Sage waitlist client error: ${context}`, {
    error: (err as Error).message,
  });
}
