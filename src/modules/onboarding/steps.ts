/**
 * Canonical onboarding question map — the single source of truth that ALL channels
 * (web guide, phone, SMS) walk. Each question is asked one at a time, in plain
 * language (rewritten via register() at send time), and persisted to the `applications`
 * row (the system of record).
 *
 * `sensitive` questions (SSN, DOB, payment) are WEB-ONLY: never spoken or echoed,
 * never collected over voice or SMS. On those channels the guide gathers everything
 * else and hands the sensitive steps to a secure web resume-link. See questionsForChannel().
 *
 * `column` is the `applications` column an answer persists to. SSN/DOB columns are
 * `*_encrypted` and are encrypted in the service before write (see service.recordAnswer).
 */

export type QuestionKind =
  | "text"
  | "name"
  | "phone"
  | "number"
  | "money"
  | "date"
  | "ssn"
  | "consent"
  | "payment";

export type Channel = "web" | "sms" | "voice" | "email";

export interface OnboardingQuestion {
  /** Stable key — also the answer field id the client sends back. */
  id: string;
  /** Step group, for the progress UI + nudge copy ("you're on references"). */
  step: string;
  /** Plain-language base prompt. register() simplifies it per send; this is grade-5 already. */
  title: string;
  /** Optional helper line under the question. */
  detail?: string;
  kind: QuestionKind;
  /** `applications` column this answer writes to (omit for payment, handled by Stripe). */
  column?: string;
  /** SSN/DOB/payment — web-only, never spoken/echoed, never over SMS/voice. */
  sensitive?: boolean;
}

/** Step groups, in order — drives the progress bar + resume cursor. */
export const ONBOARDING_STEPS = [
  "identity",
  "intent",
  "income",
  "address",
  "references",
  "verify",
  "consent",
  "payment",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * The questions, in ask order. Copy is written at ~5th-grade already; register()
 * tunes it further per recipient/channel. Keep one idea per question.
 */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "first_name",
    step: "identity",
    kind: "name",
    column: "first_name",
    title: "First — what's your first name?",
  },
  {
    id: "last_name",
    step: "identity",
    kind: "name",
    column: "last_name",
    title: "And your last name?",
  },
  {
    id: "phone",
    step: "identity",
    kind: "phone",
    column: "phone",
    title: "What's the best phone number to reach you?",
  },
  {
    id: "household_size",
    step: "intent",
    kind: "number",
    column: "household_size",
    title: "How many people will live in the home, counting you?",
  },
  {
    id: "move_in_date",
    step: "intent",
    kind: "date",
    column: "requested_move_in_date",
    title: "When are you hoping to move in? A month is fine.",
  },
  {
    id: "annual_income",
    step: "income",
    kind: "money",
    column: "annual_income",
    title: "About how much does your household make in a year? A close guess is fine.",
    detail: "We use this to find the homes you qualify for.",
  },
  {
    id: "employer_name",
    step: "income",
    kind: "text",
    column: "employer_name",
    title: "Where do you work right now? If you don't work, just say so.",
  },
  {
    id: "current_address_line1",
    step: "address",
    kind: "text",
    column: "current_address_line1",
    title: "What's the street address where you live now?",
  },
  {
    id: "current_city",
    step: "address",
    kind: "text",
    column: "current_city",
    title: "What city do you live in now?",
  },
  {
    id: "current_state",
    step: "address",
    kind: "text",
    column: "current_state",
    title: "What state?",
  },
  {
    id: "current_zip",
    step: "address",
    kind: "text",
    column: "current_zip",
    title: "And the ZIP code?",
  },
  {
    id: "emergency_contact_name",
    step: "references",
    kind: "text",
    column: "emergency_contact_name",
    title: "Who should we call in an emergency? Just their name.",
  },
  {
    id: "emergency_contact_phone",
    step: "references",
    kind: "phone",
    column: "emergency_contact_phone",
    title: "And their phone number?",
  },
  {
    id: "date_of_birth",
    step: "verify",
    kind: "date",
    column: "date_of_birth_encrypted",
    sensitive: true,
    title: "What's your date of birth?",
    detail: "We keep this private and locked.",
  },
  {
    id: "ssn",
    step: "verify",
    kind: "ssn",
    column: "ssn_encrypted",
    sensitive: true,
    title: "Your Social Security number.",
    detail: "Typed into a locked box — never read out loud. We need it to run your application.",
  },
  {
    id: "screening_consent",
    step: "consent",
    kind: "consent",
    title: "Is it okay for us to check your ID, background, and credit?",
    detail: "We can't move your application forward without your okay.",
  },
  {
    id: "payment",
    step: "payment",
    kind: "payment",
    sensitive: true,
    title: "Last step — the application fee. It's $35.95 for each adult.",
    detail: "Paid securely by card.",
  },
];

const BY_ID = new Map(ONBOARDING_QUESTIONS.map((q) => [q.id, q]));

export function questionById(id: string): OnboardingQuestion | undefined {
  return BY_ID.get(id);
}

/**
 * Questions a given channel may collect. Voice and SMS get everything that is NOT
 * sensitive; the sensitive steps (SSN/DOB/payment) are reserved for the secure web
 * hand-off. Web gets the full set.
 */
export function questionsForChannel(channel: Channel): OnboardingQuestion[] {
  if (channel === "web") return ONBOARDING_QUESTIONS;
  return ONBOARDING_QUESTIONS.filter((q) => !q.sensitive);
}

/** True once every non-sensitive question is answered — the point a voice/SMS run can
 * hand off to web for the sensitive remainder. */
export function isNonSensitiveComplete(answered: ReadonlySet<string>): boolean {
  return ONBOARDING_QUESTIONS.filter((q) => !q.sensitive).every((q) => answered.has(q.id));
}
