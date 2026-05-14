import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DollarSign, ArrowLeft, Plus, CreditCard } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { LedgerEntry, LedgerResponse, LedgerBalanceResponse, DelinquencyRecord, DelinquencyResponse } from '@/types';

// ── Delinquency overview (no applicationId in URL) ──────────────
export function LedgerOverview() {
  const { data, loading, refetch } = useApiQuery<DelinquencyResponse>('/api/ledger/delinquencies');
  const navigate = useNavigate();
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const delinquencies = data?.delinquencies || [];
  const totalOwed = delinquencies.reduce((sum, d) => sum + d.balance, 0);
  const over30 = delinquencies.filter((d) => d.daysOverdue >= 30).length;
  const over60 = delinquencies.filter((d) => d.daysOverdue >= 60).length;
  const over90 = delinquencies.filter((d) => d.daysOverdue >= 90).length;
  const evictionFlags = delinquencies.filter((d) => d.evictionTrigger).length;

  const columns: Column<DelinquencyRecord>[] = [
    { key: 'tenantName', header: 'Tenant' },
    { key: 'propertyName', header: 'Property' },
    {
      key: 'balance',
      header: 'Balance',
      className: 'text-right',
      render: (r) => <span className="font-medium text-red-600">${r.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>,
    },
    {
      key: 'daysOverdue',
      header: 'Days Overdue',
      className: 'text-right',
      render: (r) => {
        const color = r.daysOverdue >= 90 ? 'text-red-700' : r.daysOverdue >= 60 ? 'text-red-500' : r.daysOverdue >= 30 ? 'text-amber-600' : 'text-gray-600';
        return <span className={color}>{r.daysOverdue}</span>;
      },
    },
    {
      key: 'latePaymentCount12Mo',
      header: 'Late (12mo)',
      className: 'text-right',
      render: (r) => (
        <span className={r.evictionTrigger ? 'font-bold text-red-700' : ''}>
          {r.latePaymentCount12Mo}{r.evictionTrigger ? ' !!!' : ''}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={DollarSign}
        title="Tenant Ledger"
        description="Delinquency overview and financial tracking"
        action={
          <RoleGate minRole="system_admin">
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    const res = await api.post<{ posted: number }>('/api/ledger/post-rent');
                    setActionMsg({ type: 'success', text: `Rent posted for ${res.posted} tenants` });
                    refetch();
                  } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                }}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Post Rent
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await api.post<{ assessed: number }>('/api/ledger/process-late-fees');
                    setActionMsg({ type: 'success', text: `Late fees assessed: ${res.assessed}` });
                    refetch();
                  } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Process Late Fees
              </button>
            </div>
          </RoleGate>
        }
      />

      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total Owed" value={`$${totalOwed.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} color="red" />
        <StatCard label="30+ Days" value={String(over30)} color="amber" />
        <StatCard label="60+ Days" value={String(over60)} color="orange" />
        <StatCard label="90+ Days" value={String(over90)} color="red" />
        <StatCard label="Eviction Flags" value={String(evictionFlags)} color={evictionFlags > 0 ? 'red' : 'gray'} />
      </div>

      <DataTable
        columns={columns}
        data={delinquencies}
        loading={loading}
        onRowClick={(r) => navigate(`/ledger/${r.applicationId}`)}
        emptyMessage="No delinquent accounts"
      />
    </div>
  );
}

// ── Tenant ledger detail (with applicationId in URL) ────────────
export function LedgerDetail() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { data: balance, refetch: refetchBalance } = useApiQuery<LedgerBalanceResponse>(
    applicationId ? `/api/ledger/${applicationId}/balance` : null
  );
  const { data: ledger, loading, refetch: refetchLedger } = useApiQuery<LedgerResponse>(
    applicationId ? `/api/ledger/${applicationId}?limit=100` : null
  );
  const [showPayment, setShowPayment] = useState(false);
  const [showCredit, setShowCredit] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditDesc, setCreditDesc] = useState('');
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refetch = () => { refetchBalance(); refetchLedger(); };

  const columns: Column<LedgerEntry>[] = [
    {
      key: 'createdAt',
      header: 'Date',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    { key: 'description', header: 'Description' },
    {
      key: 'entryType',
      header: 'Type',
      render: (r) => <StatusBadge status={r.entryType} />,
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right',
      render: (r) => (
        <span className={r.amount > 0 ? 'text-red-600' : 'text-green-600'}>
          {r.amount > 0 ? '+' : ''}{r.amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
        </span>
      ),
    },
    {
      key: 'balanceAfter',
      header: 'Balance',
      className: 'text-right',
      render: (r) => `$${r.balanceAfter.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    },
    { key: 'billingPeriod', header: 'Period' },
  ];

  const bal = balance?.balance ?? 0;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate('/ledger')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to Delinquencies
      </button>

      {/* Balance card */}
      <div className={`rounded-xl border p-5 ${bal > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Current Balance</p>
            <p className={`text-3xl font-bold ${bal > 0 ? 'text-red-700' : 'text-green-700'}`}>
              ${bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
            <div className="mt-1 flex gap-4 text-xs text-gray-500">
              {balance?.lastPaymentDate && <span>Last payment: {new Date(balance.lastPaymentDate).toLocaleDateString()}</span>}
              {balance?.nextDueDate && <span>Next due: {new Date(balance.nextDueDate).toLocaleDateString()}</span>}
            </div>
          </div>
          <RoleGate minRole="senior_manager">
            <div className="flex gap-2">
              <button onClick={() => setShowPayment(true)} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
                <CreditCard className="h-4 w-4" /> Record Payment
              </button>
              <button onClick={() => setShowCredit(true)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> Apply Credit
              </button>
            </div>
          </RoleGate>
        </div>
      </div>

      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      <DataTable
        columns={columns}
        data={ledger?.entries || []}
        loading={loading}
        emptyMessage="No ledger entries"
      />

      {/* Record Payment Modal */}
      <Modal open={showPayment} onClose={() => setShowPayment(false)} title="Record Payment">
        <div className="space-y-3">
          <div>
            <label className="label">Amount</label>
            <input type="number" step="0.01" min="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="input" placeholder="0.00" />
          </div>
          <div>
            <label className="label">Reference ID (optional)</label>
            <input value={payRef} onChange={(e) => setPayRef(e.target.value)} className="input" placeholder="Check #, Stripe PI, etc." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowPayment(false)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              disabled={!payAmount || parseFloat(payAmount) <= 0}
              onClick={async () => {
                try {
                  await api.post(`/api/ledger/${applicationId}/payment`, {
                    amount: parseFloat(payAmount),
                    referenceId: payRef || undefined,
                  });
                  setActionMsg({ type: 'success', text: `Payment of $${payAmount} recorded` });
                  setShowPayment(false);
                  setPayAmount('');
                  setPayRef('');
                  refetch();
                } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
              }}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Record Payment
            </button>
          </div>
        </div>
      </Modal>

      {/* Apply Credit Modal */}
      <Modal open={showCredit} onClose={() => setShowCredit(false)} title="Apply Credit">
        <div className="space-y-3">
          <div>
            <label className="label">Amount</label>
            <input type="number" step="0.01" min="0.01" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className="input" placeholder="0.00" />
          </div>
          <div>
            <label className="label">Description</label>
            <input value={creditDesc} onChange={(e) => setCreditDesc(e.target.value)} className="input" placeholder="Reason for credit" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowCredit(false)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              disabled={!creditAmount || !creditDesc || parseFloat(creditAmount) <= 0}
              onClick={async () => {
                try {
                  await api.post(`/api/ledger/${applicationId}/credit`, {
                    amount: parseFloat(creditAmount),
                    description: creditDesc,
                  });
                  setActionMsg({ type: 'success', text: `Credit of $${creditAmount} applied` });
                  setShowCredit(false);
                  setCreditAmount('');
                  setCreditDesc('');
                  refetch();
                } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Apply Credit
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] || colors.gray}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium opacity-75">{label}</p>
    </div>
  );
}
