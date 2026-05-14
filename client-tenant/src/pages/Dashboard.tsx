import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import {
  DollarSign, Wrench, Home, Clock, RefreshCw, FileText, AlertCircle
} from 'lucide-react';

interface DashboardData {
  user: { firstName: string; lastName: string; email: string };
  applications: any[];
  activeApplication: any | null;
  balance: { balance: number; nextDueDate: string | null; lastPaymentDate: string | null } | null;
  nextDue: string | null;
  openWorkOrders: number;
  recentLedger: Array<{ id: string; description: string; amount: number; entryType: string; createdAt: string }>;
  lease: { propertyName: string; unitNumber: string | null; status: string } | null;
  recertification: { cutoff_date: string; status: string } | null;
  renewal: { status: string; proposed_rent: number | null } | null;
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 h-4 w-1/3 rounded bg-gray-200" />
      <div className="h-7 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>('/tenant/dashboard')
      .then(setData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="mb-2 h-6 w-40 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { user, activeApplication, balance, openWorkOrders, recentLedger, lease, recertification, renewal } = data;

  if (!activeApplication) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <FileText className="h-12 w-12 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-900">No active application</h2>
        <p className="text-sm text-gray-500">Submit an application to access your dashboard.</p>
        <Link to="/apply" className="btn-primary">Start an application</Link>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6">
      <h1 className="mb-5 text-xl font-bold text-gray-900">
        Welcome back, {user.firstName}
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Balance card */}
        <div className="rounded-xl bg-emerald-600 p-5 text-white shadow-sm">
          <div className="flex items-center gap-2 text-emerald-100">
            <DollarSign className="h-4 w-4" />
            <span className="text-sm font-medium">Current balance</span>
          </div>
          <p className="mt-2 text-3xl font-bold">
            {balance ? fmt(balance.balance) : '—'}
          </p>
          {balance?.nextDueDate && (
            <p className="mt-1 text-xs text-emerald-200">
              Next due {fmtDate(balance.nextDueDate)}
            </p>
          )}
          <Link
            to="/pay"
            className="mt-4 inline-block rounded-lg bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Pay rent
          </Link>
        </div>

        {/* Work orders */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <Wrench className="h-4 w-4" />
            <span className="text-sm font-medium">Open work orders</span>
          </div>
          <p className="mt-2 text-3xl font-bold text-gray-900">{openWorkOrders}</p>
          <Link to="/maintenance" className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline">
            View all →
          </Link>
        </div>

        {/* Lease */}
        {lease && (
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500">
              <Home className="h-4 w-4" />
              <span className="text-sm font-medium">Lease</span>
            </div>
            <p className="mt-2 text-base font-semibold text-gray-900">{lease.propertyName}</p>
            {lease.unitNumber && (
              <p className="text-sm text-gray-500">Unit {lease.unitNumber}</p>
            )}
            <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium
              ${lease.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
              {lease.status}
            </span>
          </div>
        )}

        {/* Recertification */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <RefreshCw className="h-4 w-4" />
            <span className="text-sm font-medium">Recertification</span>
          </div>
          {recertification ? (
            <>
              <p className="mt-2 text-sm font-semibold text-amber-700">
                Due {fmtDate(recertification.cutoff_date)}
              </p>
              <p className="text-xs text-gray-500 capitalize">{recertification.status}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-400">No recertification due</p>
          )}
        </div>

        {/* Renewal */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium">Lease renewal</span>
          </div>
          {renewal ? (
            <>
              <p className="mt-2 text-sm font-semibold text-gray-900 capitalize">{renewal.status}</p>
              {renewal.proposed_rent !== null && (
                <p className="text-xs text-gray-500">Proposed rent: {fmt(renewal.proposed_rent)}/mo</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-400">Not yet eligible</p>
          )}
        </div>

        {/* Recent activity */}
        <div className="rounded-xl bg-white p-5 shadow-sm sm:col-span-2 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">Recent activity</span>
            <Link to="/ledger" className="text-xs font-medium text-emerald-600 hover:underline">See all</Link>
          </div>
          {recentLedger.length === 0 ? (
            <p className="text-sm text-gray-400">No recent transactions</p>
          ) : (
            <ul className="space-y-2">
              {recentLedger.slice(0, 5).map(entry => (
                <li key={entry.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-gray-800 line-clamp-1">{entry.description}</p>
                    <p className="text-xs text-gray-400">{fmtDate(entry.createdAt)}</p>
                  </div>
                  <span className={`ml-3 font-medium ${entry.amount < 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {entry.amount < 0 ? '-' : '+'}{fmt(entry.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
