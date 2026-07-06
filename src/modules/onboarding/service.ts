/**
 * Onboarding session service — the cross-channel progress spine.
 *
 * Owns the `onboarding_sessions` row: create, resume-by-token, and recording answers
 * one at a time as a person moves through the guide on web/phone/SMS. It STAGES
 * non-sensitive answers (the resume spine) and tracks progress; it does NOT write the
 * `applications` row itself. The final commit goes through ApplicationService (which
 * owns SSN encryption, hashSSN, duplicate-check, and compliance) — we never duplicate
 * that here. Sensitive answers (SSN/DOB/payment) are never stored in this table.
 */
import { randomBytes } from "crypto";
import { query } from "../../config/database";
import {
  ONBOARDING_QUESTIONS,
  questionById,
  questionsForChannel,
  type Channel,
} from "./steps";

export interface AnswerState {
  status: "pending" | "answered" | "skipped";
  channel?: Channel;
  at?: string;
  value?: string; // present only for non-sensitive answers
}

export interface OnboardingSession {
  id: string;
  applicationId: string | null;
  resumeToken: string;
  email: string | null;
  phoneLast4: string | null;
  currentStep: string;
  status: "active" | "complete" | "abandoned";
  answersState: Record<string, AnswerState>;
  channelPref: Channel | null;
  startedChannel: string | null;
  nudgeCount: number;
}

interface SessionRow {
  id: string;
  application_id: string | null;
  resume_token: string;
  email: string | null;
  phone_last4: string | null;
  current_step: string;
  status: OnboardingSession["status"];
  answers_state: Record<string, AnswerState> | null;
  channel_pref: Channel | null;
  started_channel: string | null;
  nudge_count: number | null;
}

function rowToSession(r: SessionRow): OnboardingSession {
  return {
    id: r.id,
    applicationId: r.application_id,
    resumeToken: r.resume_token,
    email: r.email,
    phoneLast4: r.phone_last4,
    currentStep: r.current_step,
    status: r.status,
    answersState: r.answers_state ?? {},
    channelPref: r.channel_pref,
    startedChannel: r.started_channel,
    nudgeCount: r.nudge_count ?? 0,
  };
}

function newResumeToken(): string {
  return randomBytes(24).toString("base64url");
}

function last4(phone?: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

/** First step that still needs answering for this channel (the resume cursor). */
function nextStepFor(state: Record<string, AnswerState>, channel: Channel): string {
  for (const q of questionsForChannel(channel)) {
    const s = state[q.id]?.status;
    if (s !== "answered" && s !== "skipped") return q.step;
  }
  return "done";
}

export async function createSession(opts: {
  channel: Channel;
  email?: string | null;
  phone?: string | null;
  applicationId?: string | null;
}): Promise<OnboardingSession> {
  const token = newResumeToken();
  const res = await query(
    `INSERT INTO onboarding_sessions
       (resume_token, email, phone_last4, application_id, channel_pref, started_channel, current_step)
     VALUES ($1, $2, $3, $4, $5, $5, $6)
     RETURNING *`,
    [
      token,
      opts.email ?? null,
      last4(opts.phone),
      opts.applicationId ?? null,
      opts.channel,
      ONBOARDING_QUESTIONS[0].step,
    ]
  );
  return rowToSession(res.rows[0] as SessionRow);
}

export async function getSessionByToken(token: string): Promise<OnboardingSession | null> {
  if (!token || token.length > 128) return null;
  const res = await query(`SELECT * FROM onboarding_sessions WHERE resume_token = $1 LIMIT 1`, [
    token,
  ]);
  return res.rows[0] ? rowToSession(res.rows[0] as SessionRow) : null;
}

export async function getSessionById(id: string): Promise<OnboardingSession | null> {
  const res = await query(`SELECT * FROM onboarding_sessions WHERE id = $1 LIMIT 1`, [id]);
  return res.rows[0] ? rowToSession(res.rows[0] as SessionRow) : null;
}

/**
 * Record one answer into the session + advance the resume cursor. Sensitive answers
 * (SSN/DOB/payment) are marked answered for progress but their VALUE is never stored
 * here — it rides client-side to the secure commit. `skip` records a skipped step.
 */
export async function recordAnswer(
  sessionId: string,
  questionId: string,
  value: string,
  channel: Channel,
  opts: { skip?: boolean } = {}
): Promise<OnboardingSession | null> {
  const q = questionById(questionId);
  if (!q) return null;
  const session = await getSessionById(sessionId);
  if (!session || session.status !== "active") return null;

  const state: Record<string, AnswerState> = { ...session.answersState };
  state[questionId] = {
    status: opts.skip ? "skipped" : "answered",
    channel,
    at: new Date().toISOString(),
    // value only for non-sensitive, non-skipped answers
    ...(!opts.skip && !q.sensitive ? { value } : {}),
  };

  const nextStep = nextStepFor(state, channel);
  const res = await query(
    `UPDATE onboarding_sessions
        SET answers_state = $2::jsonb, current_step = $3, last_progress_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [sessionId, JSON.stringify(state), nextStep]
  );
  return res.rows[0] ? rowToSession(res.rows[0] as SessionRow) : null;
}

export async function linkApplication(sessionId: string, applicationId: string): Promise<void> {
  await query(
    `UPDATE onboarding_sessions SET application_id = $2, updated_at = NOW() WHERE id = $1`,
    [sessionId, applicationId]
  );
}

export async function markComplete(sessionId: string): Promise<void> {
  await query(
    `UPDATE onboarding_sessions
        SET status = 'complete', current_step = 'done', updated_at = NOW()
      WHERE id = $1`,
    [sessionId]
  );
}

/** Progress summary for the client header + nudge copy ("you're on references, 3 to go"). */
export function progress(
  session: OnboardingSession,
  channel: Channel
): { answered: number; total: number; currentStep: string } {
  const qs = questionsForChannel(channel);
  const answered = qs.filter((q) => {
    const s = session.answersState[q.id]?.status;
    return s === "answered" || s === "skipped";
  }).length;
  return { answered, total: qs.length, currentStep: session.currentStep };
}
