/**
 * Concierge co-browse — Tier 1 "guided co-pilot" COACHING scripts. PURE.
 *
 * This is the safe, no-computer-use half of the co-browse vision: Frank does
 * NOT drive a browser. The APPLICANT fills out their own /apply wizard in their
 * own authenticated session; their browser reports which step they're on, and
 * Frank — live on the phone — narrates the right guidance for that step
 * (including "here's how to get your pay stubs"). Every binding/sensitive action
 * is still performed by the applicant themselves (see field-plan.ts + the hard
 * legal line in the cobrowse plan): Frank only coaches.
 *
 * This module is PURE: no DB, no logger, no I/O. It maps a wizard step key to
 * the spoken coaching script + what to look for next, so it's unit-testable
 * without a browser or a live call. The step keys mirror buildFieldPlan()'s
 * stepKeys plus a few wizard-level milestones the field plan doesn't model
 * (contact, email verification, document gathering, review, submit) — these are
 * the moments where voice coaching matters most.
 */

/** The ordered guided journey, by step key. Superset of field-plan stepKeys. */
export const GUIDED_STEP_ORDER = [
  "contact",
  "verify_email",
  "address",
  "city",
  "state",
  "zip",
  "household",
  "moveIn",
  "employer",
  "income",
  "documents",
  "ssn",
  "dob",
  "identity",
  "consent",
  "review",
  "sign",
  "pay",
  "submit",
] as const;

export type GuidedStepKey = (typeof GUIDED_STEP_ORDER)[number];

export interface CoachingScript {
  /** Stable key — matches the applicant's reported step. */
  stepKey: GuidedStepKey;
  /** Short human label (for logs + the status payload). */
  label: string;
  /** What Frank says to coach the applicant through THIS step. Plain, spoken. */
  coaching: string;
  /**
   * True when the applicant must personally perform this step — Frank may
   * explain it but must never imply he'll do it for them (the hard legal line).
   * The status payload surfaces this so the agent prompt can guard its phrasing.
   */
  applicantMustDo: boolean;
}

const SCRIPTS: Record<GuidedStepKey, CoachingScript> = {
  contact: {
    stepKey: "contact",
    label: "Your contact info",
    coaching:
      "Let's start with your contact details. I've filled in your name and " +
      "phone from our call — just check they're right and add your email so we " +
      "can send you updates.",
    applicantMustDo: false,
  },
  verify_email: {
    stepKey: "verify_email",
    label: "Verify your email",
    coaching:
      "I just need you to confirm your email. Check your inbox for a message " +
      "and tap the link inside — that proves the email is yours. This part has " +
      "to be you; I can't click it for you. Tell me once you've tapped it.",
    applicantMustDo: true,
  },
  address: {
    stepKey: "address",
    label: "Current address",
    coaching:
      "Now your current street address — where you live today, not the unit " +
      "you're applying for. I've put in the city we talked about; just add the " +
      "street and apartment number if you have one.",
    applicantMustDo: false,
  },
  city: {
    stepKey: "city",
    label: "City",
    coaching: "Confirm the city — I prefilled it from our call.",
    applicantMustDo: false,
  },
  state: {
    stepKey: "state",
    label: "State",
    coaching: "Pick your state from the dropdown.",
    applicantMustDo: false,
  },
  zip: {
    stepKey: "zip",
    label: "ZIP code",
    coaching: "Add your five-digit ZIP code.",
    applicantMustDo: false,
  },
  household: {
    stepKey: "household",
    label: "Household size",
    coaching:
      "Household size is everyone who'll live in the apartment, including you " +
      "and any kids. I noted what you told me — does that number still look " +
      "right?",
    applicantMustDo: false,
  },
  moveIn: {
    stepKey: "moveIn",
    label: "Move-in date",
    coaching:
      "Put your ideal move-in date. It doesn't have to be exact — a best guess " +
      "is fine, and you can change it later.",
    applicantMustDo: false,
  },
  employer: {
    stepKey: "employer",
    label: "Employer",
    coaching:
      "Enter your employer's name. If you're self-employed, put your business " +
      "name; if you're not working right now, we'll cover income a different " +
      "way in the next step.",
    applicantMustDo: false,
  },
  income: {
    stepKey: "income",
    label: "Annual income",
    coaching:
      "For income, enter your total income for the year before taxes. If you're " +
      "paid hourly, multiply your hourly rate by the hours you work in a week, " +
      "then by fifty-two. Include steady extras like Social Security, " +
      "disability, child support, or a second job. Your best honest estimate is " +
      "fine here — the documents in the next step are what confirm it.",
    applicantMustDo: false,
  },
  documents: {
    stepKey: "documents",
    label: "Income documents (pay stubs)",
    coaching:
      "Now the part people get stuck on — proof of income. The easiest is your " +
      "two most recent pay stubs. You can get them three ways: snap a photo of " +
      "paper stubs, log into your employer's payroll site — that's usually " +
      "ADP, Workday, Paychex, or Gusto — and download the last two as PDFs, or " +
      "check your banking app, which often has them. If you don't have pay " +
      "stubs, an offer letter, last year's W-2 or tax return, or a benefits " +
      "award letter works too. Upload what you have — you can always add the " +
      "rest later, it won't block you from finishing today.",
    applicantMustDo: false,
  },
  ssn: {
    stepKey: "ssn",
    label: "Social Security Number",
    coaching:
      "This next field is your Social Security Number. Type it in yourself — " +
      "I never ask you to read it out loud, and I can't enter it for you. It's " +
      "encrypted and only used for the background and credit check you'll " +
      "authorize in a moment.",
    applicantMustDo: true,
  },
  dob: {
    stepKey: "dob",
    label: "Date of birth",
    coaching: "Enter your date of birth — you'll type this one in yourself.",
    applicantMustDo: true,
  },
  identity: {
    stepKey: "identity",
    label: "ID verification",
    coaching:
      "Now it'll ask you to verify your ID with a photo of your license or " +
      "state ID and a quick selfie. This step is all you — follow the prompts " +
      "on your screen and tell me if anything's unclear.",
    applicantMustDo: true,
  },
  consent: {
    stepKey: "consent",
    label: "Background-check consent",
    coaching:
      "There's a consent box for the background and credit check. Read it, and " +
      "if you agree, check it yourself. I'll explain anything you want, but the " +
      "checkbox has to be you.",
    applicantMustDo: true,
  },
  review: {
    stepKey: "review",
    label: "Review",
    coaching:
      "Almost there — take a moment to read back through everything and fix " +
      "anything that looks off. We can go field by field together if you'd " +
      "like.",
    applicantMustDo: false,
  },
  sign: {
    stepKey: "sign",
    label: "Signature",
    coaching:
      "This is your signature on the application. Sign it yourself — by law " +
      "that has to be you, not me.",
    applicantMustDo: true,
  },
  pay: {
    stepKey: "pay",
    label: "Application fee",
    coaching:
      "Last step is the application fee — thirty-five ninety-five per adult. " +
      "Enter your own card details on the secure screen; I never see or handle " +
      "your card.",
    applicantMustDo: true,
  },
  submit: {
    stepKey: "submit",
    label: "Submit",
    coaching:
      "That's everything — when you're ready, tap submit yourself and you're " +
      "done. I'll confirm it came through and the property team takes it from " +
      "here. Nicely done.",
    applicantMustDo: true,
  },
};

/** Coaching script for a given step, or null when the step key is unknown. */
export function coachingFor(stepKey: string | null | undefined): CoachingScript | null {
  if (!stepKey) return null;
  return SCRIPTS[stepKey as GuidedStepKey] ?? null;
}

/** The step key that follows the given one in the guided journey, or null at the end. */
export function nextStepKey(stepKey: string | null | undefined): GuidedStepKey | null {
  if (!stepKey) return GUIDED_STEP_ORDER[0];
  const idx = GUIDED_STEP_ORDER.indexOf(stepKey as GuidedStepKey);
  if (idx < 0 || idx >= GUIDED_STEP_ORDER.length - 1) return null;
  return GUIDED_STEP_ORDER[idx + 1];
}

/** True when `stepKey` is a real step in the guided journey. */
export function isGuidedStep(stepKey: string | null | undefined): stepKey is GuidedStepKey {
  return !!stepKey && GUIDED_STEP_ORDER.includes(stepKey as GuidedStepKey);
}

export interface GuidedStatus {
  state: string;
  currentStep: GuidedStepKey | null;
  currentLabel: string | null;
  coaching: string | null;
  applicantMustDo: boolean;
  nextStep: GuidedStepKey | null;
  nextLabel: string | null;
  done: boolean;
  /** DTO carried back in the cobrowse_status tool `result` (Record<string,unknown>). */
  [k: string]: unknown;
}

/**
 * Compose the status payload the `cobrowse_status` voice tool reads back to the
 * agent: where the applicant is, what to say, and what's next. Pure — the
 * caller supplies the current step + session state from the DB.
 */
export function composeGuidedStatus(
  state: string,
  currentStep: string | null | undefined
): GuidedStatus {
  const script = coachingFor(currentStep);
  const next = nextStepKey(currentStep);
  const nextScript = next ? coachingFor(next) : null;
  return {
    state,
    currentStep: script ? script.stepKey : null,
    currentLabel: script ? script.label : null,
    coaching: script ? script.coaching : null,
    applicantMustDo: script ? script.applicantMustDo : false,
    nextStep: next,
    nextLabel: nextScript ? nextScript.label : null,
    done: currentStep === "submit",
  };
}
