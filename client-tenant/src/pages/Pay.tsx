import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

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
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <CheckCircle className="h-12 w-12 text-emerald-600" />
        <h2 className="text-xl font-bold text-gray-900">Payment posted</h2>
        <p className="text-sm text-gray-500">
          New balance: <span className="font-semibold">{fmt(success.newBalance)}</span>
        </p>
        <Link to="/dashboard" className="btn-primary">Back to dashboard</Link>
      </div>
    );
  }

  if (!dashboard?.activeApplication) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">No active application found.</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-emerald-600 hover:underline">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6">
      <h1 className="mb-5 text-xl font-bold text-gray-900">Pay Rent</h1>

      <div className="mx-auto max-w-sm space-y-5">
        {dashboard.balance && (
          <div className="rounded-xl bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Current balance</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{fmt(dashboard.balance.balance)}</p>
            {dashboard.balance.nextDueDate && (
              <p className="text-xs text-gray-400">
                Due {new Date(dashboard.balance.nextDueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handlePay} className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
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
          <button
            type="submit"
            disabled={paying || !amount || Number(amount) <= 0}
            className="btn-primary w-full py-3 text-base"
          >
            {paying ? 'Processing…' : `Pay ${amount ? fmt(Number(amount)) : '$0.00'}`}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400">
          Demo mode — no real charge will be made to any account.
        </p>
      </div>
    </div>
  );
}
