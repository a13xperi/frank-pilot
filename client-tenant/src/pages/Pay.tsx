import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getToken } from '@/api/client';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA } from '@/components/primitives';
import { useFlag } from '@/lib/flags';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

interface DashboardData {
  activeApplication: { id: string } | null;
  balance: { balance: number; nextDueDate: string | null } | null;
}

interface PaymentsConfig {
  publishableKey: string | null;
  enabled: boolean;
}

interface IntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  idempotencyKey: string;
  replay?: boolean;
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

// ──────────────────────────────────────────────────────────────────────
// Legacy (flag-off) Pay surface — preserved bit-identical from pre-BP-08.
// Anything that touches Stripe lives under the flag-on branch below.
// ──────────────────────────────────────────────────────────────────────
function LegacyPay() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loadingDash, setLoadingDash] = useState(true);
  const [amount, setAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ newBalance: number } | null>(null);

  useEffect(() => {
    api.get<DashboardData>('/tenant/dashboard')
      .then(data => {
        setDashboard(data);
        if (data.balance && data.balance.balance > 0) {
          setAmount(String(data.balance.balance.toFixed(2)));
        }
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoadingDash(false));
  }, []);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!dashboard?.activeApplication) return;
    setError(null);
    setPaying(true);
    try {
      const res = await api.post<any>(
        `/tenant/applications/${dashboard.activeApplication.id}/pay`,
        { amount: Number(amount) }
      );
      const newBalance = res.balance ?? (dashboard.balance ? dashboard.balance.balance - Number(amount) : 0);
      setSuccess({ newBalance });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  if (loadingDash) {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center"
        style={{ background: HF.cream }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: HF.accent }} />
      </div>
    );
  }

  if (success) {
    return (
      <div
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <CheckCircle className="h-12 w-12" style={{ color: HF.sage }} />
        <h2 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}>
          Payment posted
        </h2>
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          New balance:{' '}
          <span style={{ color: HF.ink, fontWeight: 700 }}>{fmt(success.newBalance)}</span>
        </p>
        <Link to="/dashboard" style={{ textDecoration: 'none' }}>
          <CTA tone="primary">Back to dashboard</CTA>
        </Link>
      </div>
    );
  }

  if (!dashboard?.activeApplication) {
    return (
      <div
        className="p-6 text-center"
        style={{ background: HF.cream, minHeight: '60vh', color: HF.ink, fontFamily: HF.body }}
      >
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          No active application found.
        </p>
        <Link
          to="/dashboard"
          className="mt-4 inline-block"
          style={{
            fontFamily: HF.body,
            fontSize: 13,
            fontWeight: 600,
            color: HF.accent,
            textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div
      className="p-4 pb-24 sm:p-6"
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
    >
      <h1
        className="mb-5"
        style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}
      >
        Pay Rent
      </h1>

      <div className="mx-auto max-w-sm space-y-5">
        {dashboard.balance && (
          <Card
            variant="mobile"
            padding={16}
            elevation="none"
            style={{ background: HF.accentLo, border: `1px solid ${HF.border}` }}
          >
            <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
              Current balance
            </p>
            <p
              className="mt-1"
              style={{ fontFamily: HF.display, fontSize: 26, fontWeight: 800, color: HF.ink }}
            >
              {fmt(dashboard.balance.balance)}
            </p>
            {dashboard.balance.nextDueDate && (
              <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink3 }}>
                Due{' '}
                {new Date(dashboard.balance.nextDueDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
          </Card>
        )}

        {error && (
          <Card
            variant="mobile"
            padding={12}
            elevation="none"
            style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}
          >
            <div className="flex items-center gap-2" style={{ color: HF.err }}>
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span style={{ fontFamily: HF.body, fontSize: 13 }}>{error}</span>
            </div>
          </Card>
        )}

        <Card variant="mobile" padding={20}>
          <form onSubmit={handlePay} className="space-y-4">
            <div>
              <label className="label" htmlFor="amount">Payment amount ($)</label>
              <input
                id="amount"
                type="number"
                min={0.01}
                step={0.01}
                required
                className="input text-lg font-semibold"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <CTA
              type="submit"
              tone="primary"
              size="lg"
              block
              disabled={paying || !amount || Number(amount) <= 0}
            >
              {paying ? 'Processing…' : `Pay ${amount ? fmt(Number(amount)) : '$0.00'}`}
            </CTA>
          </form>
        </Card>

        <p
          className="text-center"
          style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}
        >
          Demo mode — no real charge will be made to any account.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stripe (flag-on) surface — only mounted when VITE_PAYMENT_WIZARD_ENABLED
// is true AND the server reports payments enabled. Server is the source
// of truth for which publishable key is live vs test.
// ──────────────────────────────────────────────────────────────────────

const ATTEMPT_STORAGE_PREFIX = 'frank.bp08.attemptN.';

function attemptStorageKey(applicationId: string): string {
  return `${ATTEMPT_STORAGE_PREFIX}${applicationId}`;
}

function loadAttemptN(applicationId: string): number {
  try {
    const raw = localStorage.getItem(attemptStorageKey(applicationId));
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } catch {
    return 1;
  }
}

function persistAttemptN(applicationId: string, attemptN: number): void {
  try {
    localStorage.setItem(attemptStorageKey(applicationId), String(attemptN));
  } catch {
    /* best-effort */
  }
}

/**
 * Resolve the API base URL the same way `src/api/client.ts` does. We can't
 * use the `api` helper directly for `/payments/intents` because we need to
 * inspect the 409 status code (which the helper translates to a thrown
 * Error), and looking at error.message strings to distinguish 409 from any
 * other failure would be fragile.
 */
function resolveApiBase(): string {
  const baseUrl =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  return baseUrl;
}

interface MintIntentArgs {
  applicationId: string;
  amountCents: number;
  attemptN: number;
}

interface MintIntentResult {
  status: 'ok' | 'blocked' | 'error';
  data?: IntentResponse;
  message?: string;
}

export async function mintPaymentIntent(args: MintIntentArgs): Promise<MintIntentResult> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${resolveApiBase()}/api/payments/intents`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      applicationId: args.applicationId,
      amountCents: args.amountCents,
      currency: 'usd',
      attemptN: args.attemptN,
    }),
  });

  if (res.status === 409) {
    return { status: 'blocked' };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    return { status: 'error', message: body.error || `Request failed: ${res.status}` };
  }
  const data = (await res.json()) as IntentResponse;
  return { status: 'ok', data };
}

function StripePaymentForm({ onError }: { onError: (msg: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/pay?status=complete`,
      },
    });
    if (error) onError(error.message ?? 'Payment failed');
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <CTA type="submit" tone="primary" size="lg" block disabled={!stripe || submitting}>
        {submitting ? 'Processing…' : 'Pay now'}
      </CTA>
    </form>
  );
}

interface StripePayProps {
  applicationId: string;
  amountCents: number;
  balance: DashboardData['balance'];
  config: PaymentsConfig;
}

function StripePay({ applicationId, amountCents, balance, config }: StripePayProps) {
  // Stripe.js loader is lazy + memoized — same publishableKey across re-renders
  // returns the same Promise, so we only download Stripe.js once per session.
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!config.publishableKey) return null;
    return loadStripe(config.publishableKey);
  }, [config.publishableKey]);

  const [attemptN, setAttemptN] = useState<number>(() => loadAttemptN(applicationId));
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMinting(true);
    setError(null);

    async function go() {
      let attempt = attemptN;
      // The 409 retry loop is bounded: at most a few bumps before we surface
      // an error. Server-side terminal states never resurrect, so eventually
      // either a fresh attemptN goes through, or something is genuinely off.
      for (let i = 0; i < 5; i++) {
        const result = await mintPaymentIntent({
          applicationId,
          amountCents,
          attemptN: attempt,
        });
        if (cancelled) return;
        if (result.status === 'ok' && result.data) {
          setClientSecret(result.data.clientSecret);
          persistAttemptN(applicationId, attempt);
          setAttemptN(attempt);
          setMinting(false);
          return;
        }
        if (result.status === 'blocked') {
          attempt += 1;
          continue;
        }
        setError(result.message ?? 'Failed to start payment');
        setMinting(false);
        return;
      }
      setError('Could not start a fresh payment attempt — please refresh.');
      setMinting(false);
    }

    void go();
    return () => {
      cancelled = true;
    };
    // amountCents + applicationId are stable per parent render; ignoring
    // attemptN here is intentional — we use its INITIAL value, then drive
    // bumps inside the loop. Pulling it into the dep array would re-fire
    // the effect after every bump and re-mint a duplicate intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, amountCents]);

  if (minting) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: HF.accent }} />
      </div>
    );
  }

  if (error) {
    return (
      <Card
        variant="mobile"
        padding={12}
        elevation="none"
        style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}
      >
        <div className="flex items-center gap-2" style={{ color: HF.err }}>
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span style={{ fontFamily: HF.body, fontSize: 13 }}>{error}</span>
        </div>
      </Card>
    );
  }

  if (!stripePromise || !clientSecret) {
    return (
      <Card variant="mobile" padding={12} elevation="none">
        <span style={{ fontFamily: HF.body, fontSize: 13 }}>Payments not available.</span>
      </Card>
    );
  }

  return (
    <div
      className="p-4 pb-24 sm:p-6"
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
    >
      <h1
        className="mb-5"
        style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}
      >
        Pay Rent
      </h1>

      <div className="mx-auto max-w-sm space-y-5">
        {balance && (
          <Card
            variant="mobile"
            padding={16}
            elevation="none"
            style={{ background: HF.accentLo, border: `1px solid ${HF.border}` }}
          >
            <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
              Current balance
            </p>
            <p
              className="mt-1"
              style={{ fontFamily: HF.display, fontSize: 26, fontWeight: 800, color: HF.ink }}
            >
              {fmt(balance.balance)}
            </p>
          </Card>
        )}

        <Card variant="mobile" padding={20}>
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <StripePaymentForm onError={setError} />
          </Elements>
        </Card>

        <p className="text-center" style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink4 }}>
          Secured by Stripe. Attempt #{attemptN}.
        </p>
      </div>
    </div>
  );
}

function StripePayContainer() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<DashboardData>('/tenant/dashboard'),
      api.get<PaymentsConfig>('/payments/config'),
    ])
      .then(([dash, cfg]) => {
        if (cancelled) return;
        setDashboard(dash);
        setConfig(cfg);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center"
        style={{ background: HF.cream }}
      >
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: HF.accent }} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="p-6 text-center"
        style={{ background: HF.cream, minHeight: '60vh', color: HF.ink, fontFamily: HF.body }}
      >
        <Card
          variant="mobile"
          padding={12}
          elevation="none"
          style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}
        >
          <div className="flex items-center gap-2" style={{ color: HF.err }}>
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span style={{ fontFamily: HF.body, fontSize: 13 }}>{error}</span>
          </div>
        </Card>
      </div>
    );
  }

  if (!config || !config.enabled || !config.publishableKey) {
    return (
      <div
        className="p-6 text-center"
        style={{ background: HF.cream, minHeight: '60vh', color: HF.ink, fontFamily: HF.body }}
      >
        <h2 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, color: HF.ink }}>
          Payments not available
        </h2>
        <p
          className="mt-2"
          style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}
        >
          Online rent payments aren't enabled for your account yet. Please contact
          your property manager.
        </p>
        <Link
          to="/dashboard"
          className="mt-4 inline-block"
          style={{
            fontFamily: HF.body,
            fontSize: 13,
            fontWeight: 600,
            color: HF.accent,
            textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!dashboard?.activeApplication || !dashboard.balance || dashboard.balance.balance <= 0) {
    return (
      <div
        className="p-6 text-center"
        style={{ background: HF.cream, minHeight: '60vh', color: HF.ink, fontFamily: HF.body }}
      >
        <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3 }}>
          Nothing due right now.
        </p>
        <Link
          to="/dashboard"
          className="mt-4 inline-block"
          style={{
            fontFamily: HF.body,
            fontSize: 13,
            fontWeight: 600,
            color: HF.accent,
            textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const amountCents = Math.round(dashboard.balance.balance * 100);

  return (
    <StripePay
      applicationId={dashboard.activeApplication.id}
      amountCents={amountCents}
      balance={dashboard.balance}
      config={config}
    />
  );
}

export function Pay() {
  const enabled = useFlag('PAYMENT_WIZARD_ENABLED');
  if (!enabled) return <LegacyPay />;
  return <StripePayContainer />;
}
