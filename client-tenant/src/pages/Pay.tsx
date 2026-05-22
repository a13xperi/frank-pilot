import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA } from '@/components/primitives';

interface DashboardData {
  activeApplication: { id: string } | null;
  balance: { balance: number; nextDueDate: string | null } | null;
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

export function Pay() {
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
