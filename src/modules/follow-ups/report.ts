import { query } from "../../config/database";
import { computeMissingByPhone } from "../requirements/service";

/**
 * Follow-ups operator report — the "where things sit" calendar/board for the
 * scheduled-callback loop, read straight from this app's own DB (the cockpit
 * surface; `bs followups` thin-wraps `npm run cli followups`).
 *
 * Three lenses:
 *   agenda  — open follow-ups (pending/in_progress) by day: the calendar.
 *   board   — counts by status: where the whole loop stands.
 *   detail  — one follow-up's full record + missing items + a progression
 *             timeline (scheduled -> attempts -> outcome).
 *
 * Read-only. PII-minimal: phones are masked to last-4 in rendered output.
 */

export interface AgendaRow {
  id: string;
  phoneMasked: string;
  scheduledForIso: string;
  reason: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  missing: string[];
  checkpoint: string | null;
}

export interface BoardCount {
  status: string;
  count: number;
}

export interface FollowUpDetail {
  id: string;
  phoneMasked: string;
  reason: string;
  status: string;
  scheduledForIso: string;
  attempts: number;
  maxAttempts: number;
  consentOutbound: boolean;
  source: string | null;
  voiceCallId: string | null;
  outboundConversationId: string | null;
  checkpoint: string | null;
  notes: string | null;
  missing: string[];
  timeline: { at: string; event: string }[];
}

export function maskPhone(phone: string | null): string {
  if (!phone || phone.length <= 4) return "****";
  return `***${phone.slice(-4)}`;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

/** Open follow-ups (the calendar), soonest first, with each one's missing items. */
export async function getAgenda(limit = 100): Promise<AgendaRow[]> {
  const res = await query(
    `SELECT id, phone_e164, reason, scheduled_for, status, attempts, max_attempts, checkpoint
       FROM follow_ups
      WHERE status IN ('pending','in_progress')
      ORDER BY scheduled_for ASC
      LIMIT $1`,
    [limit]
  );
  const rows: AgendaRow[] = [];
  for (const r of res.rows) {
    const { missing } = await computeMissingByPhone(r.phone_e164 as string);
    rows.push({
      id: r.id as string,
      phoneMasked: maskPhone(r.phone_e164 as string),
      scheduledForIso: toIso(r.scheduled_for),
      reason: r.reason as string,
      status: r.status as string,
      attempts: Number(r.attempts ?? 0),
      maxAttempts: Number(r.max_attempts ?? 3),
      missing: missing.map((m) => m.label),
      checkpoint: (r.checkpoint as string) ?? null,
    });
  }
  return rows;
}

/** Status histogram across all follow-ups — where the loop stands. */
export async function getBoard(): Promise<BoardCount[]> {
  const res = await query(
    `SELECT status, COUNT(*)::int AS count FROM follow_ups GROUP BY status ORDER BY count DESC`
  );
  return res.rows.map((r) => ({ status: r.status as string, count: Number(r.count) }));
}

/** One follow-up's full record + missing items + a derived progression timeline. */
export async function getDetail(id: string): Promise<FollowUpDetail | null> {
  const res = await query(`SELECT * FROM follow_ups WHERE id = $1`, [id]);
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  const { missing } = await computeMissingByPhone(r.phone_e164 as string);

  const timeline: { at: string; event: string }[] = [];
  if (r.created_at) timeline.push({ at: toIso(r.created_at), event: "scheduled" });
  if (r.last_attempted_at) timeline.push({ at: toIso(r.last_attempted_at), event: `attempt ${r.attempts}` });
  if (r.outbound_conversation_id)
    timeline.push({ at: toIso(r.updated_at), event: `callback placed (${r.outbound_conversation_id})` });
  if (["completed", "declined", "expired", "no_answer"].includes(r.status as string))
    timeline.push({ at: toIso(r.updated_at), event: `closed: ${r.status}` });

  return {
    id: r.id as string,
    phoneMasked: maskPhone(r.phone_e164 as string),
    reason: r.reason as string,
    status: r.status as string,
    scheduledForIso: toIso(r.scheduled_for),
    attempts: Number(r.attempts ?? 0),
    maxAttempts: Number(r.max_attempts ?? 3),
    consentOutbound: Boolean(r.consent_outbound),
    source: (r.source as string) ?? null,
    voiceCallId: (r.voice_call_id as string) ?? null,
    outboundConversationId: (r.outbound_conversation_id as string) ?? null,
    checkpoint: (r.checkpoint as string) ?? null,
    notes: (r.notes as string) ?? null,
    missing: missing.map((m) => m.label),
    timeline,
  };
}

// ── Renderers (plain text for the terminal) ────────────────────────────────

function dayKey(iso: string): string {
  return iso.slice(0, 10) || "(no date)";
}

function timeOf(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : "--:--";
}

export function renderAgenda(rows: AgendaRow[]): string {
  if (rows.length === 0) return "No open follow-ups. The callback queue is clear.";
  const out: string[] = [`Follow-up agenda — ${rows.length} open callback(s)`, ""];
  let day = "";
  for (const r of rows) {
    const d = dayKey(r.scheduledForIso);
    if (d !== day) {
      day = d;
      out.push(`  ${d}`);
    }
    const gap = r.missing.length ? `needs: ${r.missing.join(", ")}` : r.checkpoint ? `resume: ${r.checkpoint}` : r.reason;
    out.push(
      `    ${timeOf(r.scheduledForIso)}  ${r.phoneMasked}  [${r.status} ${r.attempts}/${r.maxAttempts}]  ${gap}  · ${r.id.slice(0, 8)}`
    );
  }
  return out.join("\n");
}

export function renderBoard(counts: BoardCount[]): string {
  if (counts.length === 0) return "No follow-ups on record yet.";
  const total = counts.reduce((s, c) => s + c.count, 0);
  const out: string[] = [`Follow-up board — ${total} total`, ""];
  for (const c of counts) out.push(`  ${c.status.padEnd(13)} ${c.count}`);
  return out.join("\n");
}

export function renderDetail(d: FollowUpDetail | null): string {
  if (!d) return "No follow-up with that id.";
  const out: string[] = [
    `Follow-up ${d.id}`,
    `  who         ${d.phoneMasked}`,
    `  reason      ${d.reason}`,
    `  status      ${d.status}  (${d.attempts}/${d.maxAttempts} attempts)`,
    `  scheduled   ${d.scheduledForIso}`,
    `  consent     ${d.consentOutbound ? "yes (auto-dial allowed)" : "no (operator must place)"}`,
    `  still needs ${d.missing.length ? d.missing.join(", ") : "(nothing outstanding)"}`,
  ];
  if (d.checkpoint) out.push(`  checkpoint  ${d.checkpoint}`);
  if (d.notes) out.push(`  notes       ${d.notes}`);
  out.push("", "  timeline");
  for (const t of d.timeline) out.push(`    ${t.at}  ${t.event}`);
  return out.join("\n");
}
