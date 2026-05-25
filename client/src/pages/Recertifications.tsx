import { useState } from 'react';
import { CalendarClock, AlertTriangle, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { ResponsiveCards } from '@/components/ResponsiveCards';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { Recertification, RecertificationListResponse } from '@/types';

const STATUS_TABS = ['All', 'Pending', 'Overdue', 'Submitted', 'Approved', 'Denied'] as const;
type Tab = (typeof STATUS_TABS)[number];

const TAB_FILTER: Record<Tab, string | undefined> = {
  All: undefined,
  Pending: 'pending',
  Overdue: 'overdue',
  Submitted: 'submitted',
  Approved: 'approved',
  Denied: 'denied',
};

const columns: Column<Recertification>[] = [
  { key: 'tenantName', header: 'Tenant' },
  { key: 'propertyName', header: 'Property' },
  { key: 'type', header: 'Type' },
  {
    key: 'anniversaryDate',
    header: 'Anniversary',
    render: (r) => new Date(r.anniversaryDate).toLocaleDateString(),
  },
  {
    key: 'cutoffDate',
    header: 'Cutoff',
    render: (r) => new Date(r.cutoffDate).toLocaleDateString(),
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'lastReminder',
    header: 'Last Reminder',
    render: (r) => {
      const last = r.reminder60SentAt || r.reminder90SentAt || r.reminder120SentAt;
      return last ? new Date(last).toLocaleDateString() : '—';
    },
  },
];

export function Recertifications() {
  const [tab, setTab] = useState<Tab>('All');
  const [selected, setSelected] = useState<Recertification | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const statusFilter = TAB_FILTER[tab];
  const queryPath = statusFilter
    ? `/api/recertifications?status=${statusFilter}&limit=100`
    : '/api/recertifications?limit=100';
  const { data, loading, refetch } = useApiQuery<RecertificationListResponse>(queryPath);

  // Summary stats
  const allData = useApiQuery<RecertificationListResponse>('/api/recertifications?limit=500');
  const all = allData.data?.recertifications || [];
  const pendingCount = all.filter((r) => ['pending', 'reminder_120', 'reminder_90', 'reminder_60'].includes(r.status)).length;
  const overdueCount = all.filter((r) => r.status === 'overdue').length;
  const dueIn30 = all.filter((r) => {
    if (['approved', 'denied', 'market_rent_applied'].includes(r.status)) return false;
    const days = Math.ceil((new Date(r.anniversaryDate).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 30;
  }).length;
  const dueIn60 = all.filter((r) => {
    if (['approved', 'denied', 'market_rent_applied'].includes(r.status)) return false;
    const days = Math.ceil((new Date(r.anniversaryDate).getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 60;
  }).length;

  async function doReview(decision: 'pass' | 'fail') {
    if (!selected || !reviewNotes.trim()) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      await api.post(`/api/recertifications/${selected.id}/review`, {
        decision,
        notes: reviewNotes,
      });
      setActionMsg({ type: 'success', text: `Recertification ${decision === 'pass' ? 'approved' : 'denied'}` });
      setSelected(null);
      setReviewNotes('');
      refetch();
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Review failed' });
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CalendarClock}
        title="Recertifications"
        description="Annual HUD recertification tracking and review"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Pending" value={pendingCount} icon={Clock} color="blue" />
        <StatCard label="Overdue" value={overdueCount} icon={AlertTriangle} color="red" />
        <StatCard label="Due in 30 Days" value={dueIn30} icon={CalendarClock} color="amber" />
        <StatCard label="Due in 60 Days" value={dueIn60} icon={CalendarClock} color="gray" />
      </div>

      {/* Status feedback */}
      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Table at md+, stacked cards below md (same columns + data + handler). */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={data?.recertifications || []}
          loading={loading}
          onRowClick={(r) => setSelected(r)}
          emptyMessage="No recertifications found"
        />
      </div>
      <ResponsiveCards
        className="md:hidden"
        columns={columns}
        data={data?.recertifications || []}
        loading={loading}
        onRowClick={(r) => setSelected(r)}
        emptyMessage="No recertifications found"
      />

      {/* Detail / Review Modal */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setReviewNotes(''); }} title={`Recertification: ${selected?.tenantName || ''}`} wide>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Property" value={selected.propertyName} />
              <Detail label="Type" value={selected.type} />
              <Detail label="Anniversary" value={new Date(selected.anniversaryDate).toLocaleDateString()} />
              <Detail label="Cutoff" value={new Date(selected.cutoffDate).toLocaleDateString()} />
              <Detail label="TRACS Deadline" value={new Date(selected.tracsDeadline).toLocaleDateString()} />
              <Detail label="Status" value={selected.status.replace(/_/g, ' ')} />
              <Detail label="Previous Income" value={selected.previousAnnualIncome ? `$${selected.previousAnnualIncome.toLocaleString()}` : '—'} />
              <Detail label="New Income" value={selected.newAnnualIncome ? `$${selected.newAnnualIncome.toLocaleString()}` : '—'} />
            </div>

            {/* Reminder timeline */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase">Reminders</p>
              <ReminderRow label="120-day" sent={selected.reminder120SentAt} />
              <ReminderRow label="90-day" sent={selected.reminder90SentAt} />
              <ReminderRow label="60-day" sent={selected.reminder60SentAt} />
            </div>

            {/* Review section */}
            {selected.status === 'submitted' && (
              <RoleGate minRole="senior_manager">
                <div className="space-y-3 border-t border-gray-200 pt-3">
                  <p className="text-sm font-medium text-gray-700">Review Decision</p>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Review notes (required)"
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => doReview('pass')}
                      disabled={!reviewNotes.trim()}
                      loading={actionLoading}
                    >
                      <CheckCircle className="h-4 w-4" /> Approve
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => doReview('fail')}
                      disabled={!reviewNotes.trim()}
                      loading={actionLoading}
                    >
                      <XCircle className="h-4 w-4" /> Deny
                    </Button>
                  </div>
                </div>
              </RoleGate>
            )}

            {/* Completed review */}
            {selected.reviewedAt && (
              <div className="border-t border-gray-200 pt-3 space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase">Review</p>
                <p className="text-sm"><StatusBadge status={selected.reviewDecision || ''} /> on {new Date(selected.reviewedAt).toLocaleDateString()}</p>
                {selected.reviewNotes && <p className="text-sm text-gray-600">{selected.reviewNotes}</p>}
                {selected.rentAdjustment != null && selected.rentAdjustment !== 0 && (
                  <p className="text-sm text-gray-600">Rent adjustment: ${selected.rentAdjustment}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    gray: 'bg-gray-50 text-gray-700',
  };
  return (
    <div className={`rounded-xl border border-gray-200 p-4 ${colors[color] || colors.gray}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="mt-1 text-xs font-medium opacity-75">{label}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-900">{value || '—'}</p>
    </div>
  );
}

function ReminderRow({ label, sent }: { label: string; sent: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {sent ? (
        <CheckCircle className="h-4 w-4 text-green-500" />
      ) : (
        <Clock className="h-4 w-4 text-gray-300" />
      )}
      <span className="text-gray-600">{label}</span>
      {sent && <span className="text-xs text-gray-400">{new Date(sent).toLocaleDateString()}</span>}
    </div>
  );
}
