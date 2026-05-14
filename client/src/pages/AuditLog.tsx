import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { hasMinRole, formatRole, type AuditLogResponse, type AuditEntry } from '@/types';

const columns: Column<AuditEntry>[] = [
  {
    key: 'created_at',
    header: 'Time',
    render: (r) => new Date(r.created_at).toLocaleString(),
    className: 'whitespace-nowrap',
  },
  {
    key: 'action',
    header: 'Action',
    render: (r) => (
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono">
        {r.action}
      </span>
    ),
  },
  {
    key: 'actor_role',
    header: 'Actor',
    render: (r) => formatRole(r.actor_role as 'leasing_agent'),
  },
  { key: 'resource_type', header: 'Resource' },
  {
    key: 'details',
    header: 'Details',
    render: (r) => {
      const d = r.details;
      if (!d || Object.keys(d).length === 0) return '—';
      const summary = Object.entries(d)
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return <span className="text-xs text-gray-500">{summary}</span>;
    },
  },
];

export function AuditLog() {
  const { user } = useAuth();
  const [applicationId, setApplicationId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const limit = 25;

  const queryParams = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (applicationId) queryParams.set('applicationId', applicationId);
  if (action) queryParams.set('action', action);

  const { data, loading } = useApiQuery<AuditLogResponse>(
    user && hasMinRole(user.role, 'regional_manager') ? `/api/audit?${queryParams}` : null
  );

  if (!user || !hasMinRole(user.role, 'regional_manager')) {
    return <p className="text-sm text-red-600">Access denied. Regional Manager or above required.</p>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ScrollText}
        title="Audit Log"
        description="Immutable record of all system actions"
      />

      <div className="flex gap-3">
        <input
          placeholder="Filter by Application ID..."
          value={applicationId}
          onChange={(e) => { setApplicationId(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-72 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Actions</option>
          <option value="application_created">Application Created</option>
          <option value="application_submitted">Application Submitted</option>
          <option value="screening_initiated">Screening Initiated</option>
          <option value="tier1_approved">Tier 1 Approved</option>
          <option value="tier1_denied">Tier 1 Denied</option>
          <option value="tier2_approved">Tier 2 Approved</option>
          <option value="tier2_denied">Tier 2 Denied</option>
          <option value="tier3_approved">Tier 3 Approved</option>
          <option value="tier3_denied">Tier 3 Denied</option>
          <option value="fraud_flag_raised">Fraud Flag Raised</option>
          <option value="fraud_flag_resolved">Fraud Flag Resolved</option>
          <option value="lease_generated">Lease Generated</option>
          <option value="tenant_onboarded">Tenant Onboarded</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={data?.logs || []}
        loading={loading}
        emptyMessage="No audit entries found"
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Showing {page * limit + 1}–{page * limit + (data?.logs?.length || 0)}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(data?.logs?.length || 0) < limit}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
