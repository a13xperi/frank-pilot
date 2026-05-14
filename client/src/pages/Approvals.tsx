import { useState } from 'react';
import { CheckCircle, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { api } from '@/api/client';
import { hasMinRole, type Application, type ApplicationListResponse } from '@/types';

const TIERS = [
  { key: 'tier1', label: 'Tier 1 — Senior Manager', statuses: ['screening_passed', 'tier1_review'], endpoint: 'tier1', minRole: 'senior_manager' as const },
  { key: 'tier2', label: 'Tier 2 — Regional Manager', statuses: ['tier1_approved', 'tier2_review'], endpoint: 'tier2', minRole: 'regional_manager' as const },
  { key: 'tier3', label: 'Tier 3 — Asset Manager', statuses: ['tier2_approved', 'tier3_review'], endpoint: 'tier3', minRole: 'asset_manager' as const },
];

const columns: Column<Application>[] = [
  { key: 'name', header: 'Applicant', render: (r) => `${r.first_name} ${r.last_name}` },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'unit_number', header: 'Unit' },
  { key: 'annual_income', header: 'Income', className: 'text-right', render: (r) => r.annual_income != null ? `$${r.annual_income.toLocaleString()}` : '—' },
  { key: 'household_size', header: 'HH Size', className: 'text-right' },
];

export function Approvals() {
  const { user } = useAuth();
  const { data, loading, refetch } = useApiQuery<ApplicationListResponse>('/api/applications');
  const [activeTier, setActiveTier] = useState('tier1');
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  if (!user || !hasMinRole(user.role, 'senior_manager')) {
    return <p className="text-sm text-red-600">Access denied. Senior Manager or above required.</p>;
  }

  const allApps = data?.applications || [];
  const tier = TIERS.find((t) => t.key === activeTier)!;
  const queue = allApps.filter((a) => tier.statuses.includes(a.status));

  async function decide(decision: 'pass' | 'fail') {
    if (!selectedApp || !notes.trim()) {
      setActionError('Review notes are required');
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      await api.post(`/api/approvals/${selectedApp.id}/${tier.endpoint}`, { decision, notes });
      setSelectedApp(null);
      setNotes('');
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={CheckCircle}
        title="Approvals"
        description="3-tier review workflow with separation of duties"
      />

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {TIERS.map((t) => {
          const count = allApps.filter((a) => t.statuses.includes(a.status)).length;
          const canView = hasMinRole(user.role, t.minRole);
          if (!canView) return null;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTier(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTier === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-gray-400">{count}</span>
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        data={queue}
        loading={loading}
        onRowClick={(a) => { setSelectedApp(a); setNotes(''); setActionError(''); }}
        emptyMessage={`No applications pending ${tier.label}`}
      />

      {/* Review Modal */}
      <Modal
        open={!!selectedApp}
        onClose={() => setSelectedApp(null)}
        title={selectedApp ? `Review: ${selectedApp.first_name} ${selectedApp.last_name}` : ''}
        wide
      >
        {selectedApp && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 rounded-lg bg-gray-50 p-4 text-sm">
              <div><span className="text-gray-500">Unit:</span> {selectedApp.unit_number || 'TBD'}</div>
              <div><span className="text-gray-500">Household:</span> {selectedApp.household_size} persons</div>
              <div><span className="text-gray-500">Income:</span> {selectedApp.annual_income != null ? `$${selectedApp.annual_income.toLocaleString()}` : '—'}</div>
              <div><span className="text-gray-500">Status:</span> <StatusBadge status={selectedApp.status} /></div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Review Notes (required) — typed comments, not handwritten
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Enter your review notes..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}

            <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
              <button
                onClick={() => decide('fail')}
                disabled={actionLoading}
                className="flex items-center gap-1.5 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                <ThumbsDown className="h-4 w-4" /> Deny
              </button>
              <button
                onClick={() => decide('pass')}
                disabled={actionLoading}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <ThumbsUp className="h-4 w-4" /> Approve
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
