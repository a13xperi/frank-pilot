import { useEffect, useRef } from 'react';
import type { Step } from './ApplyContext';

/**
 * Tier 1 "guided co-pilot" — client step reporter.
 *
 * When the applicant opened /apply from Frank's texted co-browse link
 * (`?cobrowse=<sessionId>&vt=<token>`), this reports which wizard step (and,
 * via reportCobrowseField, which Step2Details field) they're on to
 * POST /api/cobrowse/:id/step. Frank — live on the phone — polls
 * `cobrowse_status` and narrates the coaching for that step.
 *
 * SAFE BY DESIGN: we send only the STEP KEY, never field values. The applicant
 * does every binding action in their own session; this is presence, not
 * control. Fire-and-forget + deduped: a failed/absent endpoint (feature dark,
 * 503) never disrupts the application. No-op unless both query params are present.
 */

// Mirror of the server's guided step keys (src/modules/cobrowse/runtime/coaching.ts).
export type GuidedStepKey =
  | 'contact'
  | 'verify_email'
  | 'address'
  | 'city'
  | 'state'
  | 'zip'
  | 'household'
  | 'moveIn'
  | 'employer'
  | 'income'
  | 'documents'
  | 'ssn'
  | 'dob'
  | 'identity'
  | 'consent'
  | 'review'
  | 'sign'
  | 'pay'
  | 'submit';

/**
 * Map the coarse wizard `Step` union to a guided coaching key. Steps that carry
 * no field coaching (unit pick/claim/checklist/intent) map to null — Frank stays
 * quiet on those. Step2Details (`2`) reports its screen entry as 'address' (the
 * first prefilled field); field focus then advances it via reportCobrowseField.
 */
export const WIZARD_STEP_TO_GUIDED: Partial<Record<string, GuidedStepKey>> = {
  '1': 'contact',
  verify: 'verify_email',
  household: 'household',
  '2': 'address',
  review: 'review',
  payment: 'pay',
  confirm: 'submit',
};

function stepToGuided(step: Step): GuidedStepKey | null {
  return WIZARD_STEP_TO_GUIDED[String(step)] ?? null;
}

interface CobrowseLink {
  sessionId: string;
  token: string;
}

/** Read `?cobrowse=&vt=` from the live URL, or null when not a co-browse session. */
function readCobrowseLink(): CobrowseLink | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('cobrowse')?.trim();
  const token = params.get('vt')?.trim();
  if (!sessionId || !token) return null;
  return { sessionId, token };
}

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

// Dedupe across both the hook and field reporter so we don't spam the endpoint
// with the same key (React re-renders + repeated focus on one input).
let lastReported: string | null = null;

function postStep(link: CobrowseLink, stepKey: GuidedStepKey): void {
  if (lastReported === stepKey) return;
  lastReported = stepKey;
  const url = `${apiBase()}/api/cobrowse/${encodeURIComponent(link.sessionId)}/step`;
  // Fire-and-forget; never throw into the wizard.
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step: stepKey, vt: link.token }),
    keepalive: true,
  }).catch(() => {
    // Reset so a transient failure can retry on the next transition.
    if (lastReported === stepKey) lastReported = null;
  });
}

/**
 * Report a Step2Details field the applicant just focused (e.g. 'income',
 * 'ssn', 'documents') so Frank can coach that specific field. No-op outside a
 * co-browse session. Call from onFocus — values never leave the browser.
 */
export function reportCobrowseField(fieldKey: GuidedStepKey): void {
  const link = readCobrowseLink();
  if (!link) return;
  postStep(link, fieldKey);
}

/** Hook: report the wizard-level step whenever it changes. */
export function useCobrowseStep(step: Step): void {
  const linkRef = useRef<CobrowseLink | null | undefined>(undefined);
  if (linkRef.current === undefined) linkRef.current = readCobrowseLink();

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    const guided = stepToGuided(step);
    if (guided) postStep(link, guided);
  }, [step]);
}

/** Test-only: reset the dedupe latch. */
export function __resetCobrowseReporterForTests(): void {
  lastReported = null;
}
