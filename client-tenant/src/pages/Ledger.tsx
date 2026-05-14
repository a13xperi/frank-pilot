import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { Loader2, AlertCircle, FileText } from 'lucide-react';

interface LedgerEntry {
  id: string;
  entryType: string;
  description: string;
  amount: number;
  createdAt: string;
  dueDate: string | null;
}

interface BalanceSummary {
  balance: number;
  nextDueDate: string | null;
  lastPaymentDate: string | null;
}

interface DashboardData {
  activeApplication: { id: string } | null;
  balance: BalanceSummary | null;
}

const TYPE_LABELS: Record<string, string> = {
  rent_charge: 'Rent',
  payment: 'Payment',
  credit: 'Credit',
  late_fee: 'Late fee',
  deposit: 'Deposit',
};

const TYPE_COLORS: Record<string, string> = {
  payment: 'bg-emerald-100 text-emerald-700',
  credit: 'bg-blue-100 text-blue-700',
  rent_charge: 'bg-gray-100 text-gray-600',
  late_fee: 'bg-red-100 text-red-700',
  deposit: 'bg-purple-100 text-purple-700',
};

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PAGE_SIZE = 20;

export function Ledger() {
  const [appId, setAppId] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>('/tenant/dashboard')
      .then(data => {
        if (!data.activeApplication) {
          setLoading(false);
          return;
        }
        setAppId(data.activeApplication.id);
        setBalance(data.balance);
        return api.get<{ entries: LedgerEntry[]; total: number; balance?: BalanceSummary }>(
          `/tenant/applications/${data.activeApplication.id}/ledger?limit=${PAGE_SIZE}&offset=0`
        );
      })
      .then(res => {
        if (!res) return;
        setEntries(res.entries);
        setTotal(res.total);
        if (res.balance) setBalance(res.balance);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load ledger'))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!appId) return;
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const res = await api.get<{ entries: LedgerEntry[]; total: number }>(
        `/tenant/applications/${appId}/ledger?limit=${PAGE_SIZE}&offset=${nextOffset}`
      );
      setEntries(prev => [...prev, ...res.entries]);
      setOffset(nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!appId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <FileText className="h-10 w-10 text-gray-300" />
        <p className="text-gray-500">No active application.</p>
        <Link to="/apply" className="btn-primary">Start an application</Link>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6">
      <h1 className="mb-5 text-xl font-bold text-gray-900">Account Ledger</h1>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Balance summary */}
      {balance && (
        <div className="mb-5 grid grid-cols-3 gap-3 rounded-xl bg-white p-4 shadow-sm">
          <div>
            <p className="text-xs text-gray-400">Balance</p>
            <p className={`text-base font-bold ${balance.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {fmt(balance.balance)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Next due</p>
            <p className="text-sm font-medium text-gray-900">{fmtDate(balance.nextDueDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Last payment</p>
            <p className="text-sm font-medium text-gray-900">{fmtDate(balance.lastPaymentDate)}</p>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-gray-400">No transactions yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div key={entry.id} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{entry.description}</p>
                <p className="text-xs text-gray-400">{fmtDate(entry.createdAt)}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[entry.entryType] ?? 'bg-gray-100 text-gray-600'}`}>
                {TYPE_LABELS[entry.entryType] ?? entry.entryType}
              </span>
              <span className={`shrink-0 text-sm font-semibold ${entry.amount < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {entry.amount < 0 ? '-' : '+'}{fmt(entry.amount)}
              </span>
            </div>
          ))}

          {entries.length < total && (
            <div className="pt-2 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn-primary inline-flex items-center gap-2"
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
