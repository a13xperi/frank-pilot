/**
 * Pure inbound-SMS intake state machine (Phase 1, phone-first Frank).
 *
 * Walks the same data_collection fields the ElevenLabs voice agent collects
 * (see voice-intake/service.ts pickField keys): name -> household -> income
 * -> city, then `done`. No I/O — the service layer owns load/persist; this
 * module is a deterministic reducer so it can be unit-tested in isolation and
 * reasoned about for compliance (the prompts are the canonical disclosure
 * text).
 *
 * Contract: stepSms(step, collected, inboundText) returns the NEXT step, the
 * reply to send back over TwiML, the (possibly extended) collected map, and a
 * `done` flag the service uses to fire the applications-draft insert.
 *
 * The `start` step is the cold-open: an applicant's very first text (whatever
 * the body) is acknowledged and we ask for their name, advancing to `name`.
 * Each subsequent step records the trimmed inbound under its data key, then
 * asks the next question. Empty/blank input re-prompts the SAME step (no field
 * is recorded, no advance) so a stray text can't corrupt the collected map.
 */

export type SmsStep = "start" | "name" | "household" | "income" | "city" | "done";

export interface StepResult {
  nextStep: SmsStep;
  reply: string;
  collected: Record<string, string>;
  done: boolean;
}

// Mirrors the voice intake data_collection keys (voice-intake/service.ts):
// name, household, monthly_income, current_city. Keeping the same keys means
// the SMS draft promotion can reuse the same field semantics the PM console
// already understands.
const FIELD_KEY: Partial<Record<SmsStep, string>> = {
  name: "name",
  household: "household",
  income: "monthly_income",
  city: "current_city",
};

const PROMPT: Record<SmsStep, string> = {
  start:
    "Hi, this is Frank — I help with affordable-housing applications. " +
    "Reply STOP to opt out anytime. To start, what's your full name?",
  name: "Thanks! How many people are in your household?",
  household: "Got it. What's your total monthly household income (in dollars)?",
  income: "Almost done — what city are you currently living in?",
  city:
    "Thanks! I've got your info and a Frank teammate will follow up about next steps. " +
    "Reply with any questions.",
  done:
    "You're all set — we already have your intake. A Frank teammate will follow up. " +
    "Reply with any questions.",
};

// The forward walk. Each non-terminal step advances to the next.
const NEXT: Record<SmsStep, SmsStep> = {
  start: "name",
  name: "household",
  household: "income",
  income: "city",
  city: "done",
  done: "done",
};

/**
 * Reduce one inbound text against the current step.
 *
 * - At `start`: ignore the body (it's whatever the applicant texted to begin),
 *   greet, ask for name, advance to `name`. Nothing recorded yet.
 * - At a field step (name/household/income/city): a non-blank body is recorded
 *   under that step's data key and we advance, asking the next question; a
 *   blank body re-prompts the same step without recording or advancing.
 * - At `city`: recording the city completes the walk — advance to `done`,
 *   return the closing reply, and flag `done` so the service inserts the draft.
 * - At `done`: idempotent terminal — repeat the closing reply, never re-fire.
 */
export function stepSms(
  step: SmsStep,
  collected: Record<string, string>,
  inboundText: string
): StepResult {
  const text = (inboundText ?? "").trim();
  const current: Record<string, string> = { ...collected };

  // Cold-open: first contact. Body is the opener, not an answer.
  if (step === "start") {
    return { nextStep: "name", reply: PROMPT.start, collected: current, done: false };
  }

  // Terminal: nothing left to collect.
  if (step === "done") {
    return { nextStep: "done", reply: PROMPT.done, collected: current, done: false };
  }

  const key = FIELD_KEY[step];

  // Blank answer — re-prompt the same step, record nothing, don't advance.
  if (!text) {
    return { nextStep: step, reply: PROMPT[step], collected: current, done: false };
  }

  // Record the answer under this step's data key.
  if (key) current[key] = text;

  const nextStep = NEXT[step];
  const done = nextStep === "done";

  return {
    nextStep,
    // The reply is always the prompt FOR the step we just left, which is the
    // question for the next field (or, leaving `city`, the closing line).
    reply: PROMPT[step],
    collected: current,
    done,
  };
}
