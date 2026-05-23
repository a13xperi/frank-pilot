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
import { api, getToken } from '@/api/client';

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

  // Raw amount for the tape beacons (backend expects a "35.95"-style string).
  // `paymentTotal` is the currency-formatted display string ("$35.95").
  const total = (APPLICATION_FEE * adults).toFixed(2);
  const sid = useMemo(() => sessionId(), []);

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
          try {
            await api.post('/applicants/me/applications/submit-draft', {});
          } catch {
            /* non-fatal */
          }
        }
        navigate('?step=2');
      } catch {
        setErr(t('payment.error') as string);
      } finally {
        setBusy(false);
      }
    },
    [navigate, setPaymentRef, sid, adults, t, total],
  );

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
