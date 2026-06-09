// TODO(BP-08): replace stub submit with real Stripe PaymentIntents
/**
 * StepPayment — wizard step for payment capture (Lane W3 scaffold).
 *
 * NO real Stripe wiring. On submit:
 *  1. Generate fake paymentRef (`pay_${Date.now()}_${random}`).
 *  2. POST /api/tape/payment-init  → bp03b.payment_initiated
 *  3. POST /api/tape/payment-success → bp03b.payment_succeeded
 *  4. Persist paymentRef to ApplyContext.
 *  5. Navigate ?step=2 (existing Step2Details).
 *
 * Beacons accept { session_id, adults, total }.  5xx → toast + retry.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { StepCTA } from '@/pages/apply/StepCTA';
import { useApply, APPLICATION_FEE } from '@/pages/apply/ApplyContext';
import { PayHeader } from '@/pages/apply/PayHeader';
import { api, getToken, ApiError } from '@/api/client';

type Disclosure = { version: string; text: string; hash: string };

function sessionId(): string {
  try {
    const k = 'frank_apply_session_id';
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return `s_${Date.now()}`;
  }
}

async function fireBeacon(path: string, body: object): Promise<Response> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function StepPayment() {
  const { t, i18n } = useTranslation('apply');
  const lang = (i18n.language?.startsWith('es') ? 'es' : 'en') as 'en' | 'es';
  const navigate = useNavigate();
  const { adults, setPaymentRef } = useApply();

  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // FCRA §1681b consumer-report consent gate. Driven entirely by the backend
  // signal: submit-draft returns 400 `consumer_report_consent_required` (with
  // the disclosure in the body) only when CONSUMER_REPORT_ENABLED is on and no
  // current-version authorization exists. Flag off → no 400 → this stays inert
  // and the wizard behaves exactly as before (so the frozen apply e2e/smoke
  // gates are untouched).
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentErr, setConsentErr] = useState<string | null>(null);

  // Phase 4b Stripe Identity hosted handoff. Also backend-signal-driven: when
  // IDENTITY_VERIFICATION_ENABLED is on, submit-draft parks the app in
  // `awaiting_identity` and returns a hosted Identity session `url`. We hand the
  // applicant off to that secure Stripe page; on completion Stripe redirects
  // back to /status and the webhook advances the app into screening. Flag off →
  // no `identity` in the response → this stays inert (same frozen-gate safety
  // as the consent gate above).
  const [identityUrl, setIdentityUrl] = useState<string | null>(null);

  // Raw amount for the tape beacons (backend expects a "35.95"-style string).
  // `paymentTotal` is the currency-formatted display string ("$35.95").
  const total = (APPLICATION_FEE * adults).toFixed(2);
  const sid = useMemo(() => sessionId(), []);

  // POST the draft submission. Returns 'ok' when the application advanced (or
  // failed non-fatally — the receipt still renders), or 'consent_required' when
  // the backend needs an FCRA authorization first (caller must hold and show
  // the consent gate). `consent`, when present, records the authorization.
  const submitDraft = useCallback(
    async (
      consent?: { authorized: true; disclosureVersion: string },
    ): Promise<'ok' | 'consent_required' | 'identity_required'> => {
      try {
        const body: Record<string, unknown> = {
          // Where Stripe redirects the applicant after the hosted Identity flow
          // (Phase 4b). Backend ignores it unless IDENTITY_VERIFICATION_ENABLED
          // is on, so this is harmless on every other submit.
          returnUrl: `${window.location.origin}/status`,
        };
        if (consent) body.consumerReportConsent = consent;
        const res = await api.post<{
          status?: string;
          identity?: { url: string | null; clientSecret: string | null; status: string };
        }>('/applicants/me/applications/submit-draft', body);
        // Identity capture armed → backend returns a hosted Stripe session and
        // parked the app in `awaiting_identity`. Hold and hand off to Stripe.
        if (res?.identity?.url) {
          setDisclosure(null); // single-overlay invariant if consent ran first
          setIdentityUrl(res.identity.url);
          return 'identity_required';
        }
        return 'ok';
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.status === 400 &&
          e.code === 'consumer_report_consent_required'
        ) {
          const d = (e.body as { disclosure?: Disclosure } | null)?.disclosure;
          if (d) {
            setDisclosure(d);
            return 'consent_required';
          }
        }
        // Any other failure is non-fatal — the receipt still renders and staff
        // can advance the application manually (pre-existing behavior).
        return 'ok';
      }
    },
    [],
  );

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setErr(null);
      setBusy(true);
      const payload = { session_id: sid, adults, total };
      try {
        const r1 = await fireBeacon('/api/tape/payment-init', payload);
        if (!r1.ok) throw new Error(`init ${r1.status}`);
        const ref = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const r2 = await fireBeacon('/api/tape/payment-success', { ...payload, paymentRef: ref });
        if (!r2.ok) throw new Error(`success ${r2.status}`);
        setPaymentRef(ref);
        // Flip the user's draft application to `submitted` so /status shows
        // "Submitted" instead of "Draft" after the wizard completes. Only
        // attempt when authed; non-fatal if it fails — the receipt still
        // renders and staff can advance the application manually.
        if (getToken()) {
          const outcome = await submitDraft();
          if (outcome === 'consent_required') {
            // Hold on the consent gate; do not advance until the applicant
            // authorizes the consumer-report pull.
            setBusy(false);
            return;
          }
          if (outcome === 'identity_required') {
            // Hold on the identity gate; the panel hands off to Stripe's hosted
            // capture and Stripe brings the applicant back to /status.
            setBusy(false);
            return;
          }
        }
        navigate('?step=2');
      } catch {
        setErr(t('payment.error') as string);
      } finally {
        setBusy(false);
      }
    },
    [navigate, setPaymentRef, sid, adults, t, total, submitDraft],
  );

  const affirmConsent = useCallback(async () => {
    if (!disclosure || !consentChecked) return;
    setConsentErr(null);
    setBusy(true);
    const outcome = await submitDraft({
      authorized: true,
      disclosureVersion: disclosure.version,
    });
    setBusy(false);
    if (outcome === 'ok') {
      navigate('?step=2');
    } else if (outcome === 'identity_required') {
      // Consent recorded; backend now needs identity capture. submitDraft has
      // already swapped this dialog for the identity panel — nothing to do.
    } else {
      // Backend still won't accept it — surface a retryable error.
      setConsentErr(t('consent.error') as string);
    }
  }, [disclosure, consentChecked, submitDraft, navigate, t]);

  return (
    <div style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}>
      <PayHeader step={3} total={5} lang={lang} onBack={() => navigate(-1)} />
      <form id="apply-payment-form" onSubmit={submit} className="mx-auto max-w-md p-4 flex flex-col gap-3" aria-label={t('payment.title') as string}>
        <h1 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 700 }}>{t('payment.title')}</h1>
        <p style={{ color: HF.ink3, fontSize: 13 }}>{t('payment.subtitle')}</p>

        <div role="status" aria-live="polite" style={{ background: HF.paper, border: `1px solid ${HF.border}`, borderRadius: HF.r.md, padding: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: HF.ink3, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>{t('payment.payingFor')}</span>
          <span style={{ fontWeight: 700 }}>${total}</span>
        </div>

        <Field label={t('payment.cardName') as string} value={name} onChange={setName} required autoComplete="cc-name" />
        <Field label={t('payment.cardNumber') as string} value={number} onChange={setNumber} required autoComplete="cc-number" inputMode="numeric" />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('payment.exp') as string} value={exp} onChange={setExp} required autoComplete="cc-exp" placeholder="MM/YY" />
          <Field label={t('payment.cvv') as string} value={cvv} onChange={setCvv} required autoComplete="cc-csc" inputMode="numeric" />
        </div>
        <Field label={t('payment.zip') as string} value={zip} onChange={setZip} required autoComplete="postal-code" inputMode="numeric" />

        {err && (
          <div role="alert" style={{ background: HF.errLo, border: `1px solid ${HF.err}`, color: HF.err, padding: 10, borderRadius: HF.r.sm, fontSize: 13 }}>
            {err}{' '}
            <button type="submit" style={{ textDecoration: 'underline', background: 'none', border: 'none', color: HF.err, cursor: 'pointer' }}>
              {t('payment.retry')}
            </button>
          </div>
        )}

        <StepCTA
          type="submit"
          form="apply-payment-form"
          tone="primary"
          size="lg"
          disabled={busy}
          block
          aria-busy={busy}
        >
          {busy ? (t('payment.processing') as string) : `${t('payment.payCta')} $${total}`}
        </StepCTA>
        <p style={{ textAlign: 'center', color: HF.ink3, fontSize: 11 }}>{t('payment.encrypted')}</p>
      </form>

      {disclosure && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="consent-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: HF.cream,
              borderTopLeftRadius: HF.r.lg,
              borderTopRightRadius: HF.r.lg,
              padding: 20,
              width: '100%',
              maxWidth: 480,
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <h2 id="consent-title" style={{ fontFamily: HF.display, fontSize: 19, fontWeight: 700, color: HF.ink }}>
              {t('consent.title')}
            </h2>
            <p style={{ color: HF.ink3, fontSize: 13 }}>{t('consent.intro')}</p>

            <div
              style={{
                background: HF.paper,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.sm,
                padding: 12,
                overflowY: 'auto',
                flex: '1 1 auto',
                fontSize: 12,
                lineHeight: 1.5,
                color: HF.ink,
                whiteSpace: 'pre-wrap',
              }}
            >
              {disclosure.text}
            </div>

            <label htmlFor="fcra-consent" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                id="fcra-consent"
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                style={{ marginTop: 3, width: 18, height: 18, flex: '0 0 auto' }}
              />
              <span style={{ fontSize: 13, color: HF.ink }}>{t('consent.checkbox')}</span>
            </label>

            {consentErr && (
              <div role="alert" style={{ background: HF.errLo, border: `1px solid ${HF.err}`, color: HF.err, padding: 10, borderRadius: HF.r.sm, fontSize: 13 }}>
                {consentErr}
              </div>
            )}

            <StepCTA
              type="button"
              tone="primary"
              size="lg"
              block
              disabled={busy || !consentChecked}
              aria-busy={busy}
              onClick={affirmConsent}
            >
              {busy ? (t('consent.busy') as string) : (t('consent.cta') as string)}
            </StepCTA>
          </div>
        </div>
      )}

      {identityUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="identity-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: HF.cream,
              borderTopLeftRadius: HF.r.lg,
              borderTopRightRadius: HF.r.lg,
              padding: 20,
              width: '100%',
              maxWidth: 480,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <h2 id="identity-title" style={{ fontFamily: HF.display, fontSize: 19, fontWeight: 700, color: HF.ink }}>
              {t('identity.title')}
            </h2>
            <p style={{ color: HF.ink3, fontSize: 13 }}>{t('identity.intro')}</p>
            <a
              href={identityUrl}
              style={{
                display: 'block',
                textAlign: 'center',
                textDecoration: 'none',
                background: HF.accent,
                color: HF.paper,
                fontWeight: 700,
                fontSize: 16,
                padding: '14px 16px',
                borderRadius: HF.r.md,
                fontFamily: HF.body,
              }}
            >
              {t('identity.cta')}
            </a>
            <p style={{ textAlign: 'center', color: HF.ink3, fontSize: 11 }}>{t('identity.secured')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, required, autoComplete, inputMode, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean;
  autoComplete?: string; inputMode?: 'numeric' | 'text'; placeholder?: string;
}) {
  const id = `f_${label.replace(/\s+/g, '_').toLowerCase()}`;
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span style={{ color: HF.ink3, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>{label}</span>
      <input
        id={id}
        value={value}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: HF.paper, border: `1px solid ${HF.border}`, borderRadius: HF.r.sm, padding: '10px 12px', fontSize: 16, color: HF.ink, fontFamily: HF.body }}
      />
    </label>
  );
}

export default StepPayment;
