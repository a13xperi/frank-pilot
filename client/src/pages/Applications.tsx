import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import type { Application, ApplicationListResponse } from '@/types';

const STATUS_TABS = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Screening', value: 'screening_passed' },
  { label: 'In Approval', value: 'approval' },
  { label: 'Approved', value: 'tier3_approved' },
  { label: 'Denied', value: 'denied' },
];

const APPROVAL_STATUSES = ['screening_passed', 'tier1_review', 'tier1_approved', 'tier2_review', 'tier2_approved', 'tier3_review'];
const DENIED_STATUSES = ['tier1_denied', 'tier2_denied', 'tier3_denied'];

const columns: Column<Application>[] = [
  {
    key: 'name',
    header: 'Applicant',
    render: (r) => `${r.first_name} ${r.last_name}`,
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  { key: 'unit_number', header: 'Unit' },
  {
    key: 'household_size',
    header: 'Household',
    className: 'text-right',
  },
  {
    key: 'annual_income',
    header: 'Income',
    className: 'text-right',
    render: (r) =>
      r.annual_income != null
        ? `$${r.annual_income.toLocaleString()}`
        : '—',
  },
  {
    key: 'created_at',
    header: 'Created',
    render: (r) => new Date(r.created_at).toLocaleDateString(),
  },
];

export function Applications() {
  const navigate = useNavigate();
  const { data, loading } = useApiQuery<ApplicationListResponse>('/api/applications');
  const [tab, setTab] = useState('');

  const allApps = data?.applications || [];
  const filtered = tab === ''
    ? allApps
    : tab === 'approval'
      ? allApps.filter((a) => APPROVAL_STATUSES.includes(a.status))
      : tab === 'denied'
        ? allApps.filter((a) => DENIED_STATUSES.includes(a.status))
        : allApps.filter((a) => a.status === tab);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FileText}
        title="Applications"
        description="Manage tenant applications - create, review, submit for screening"
        action={
          <button
            onClick={() => navigate('/applications/new')}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" /> New Application
          </button>
        }
      />

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {!loading && (
              <span className="ml-1.5 text-xs text-gray-400">
                {t.value === ''
                  ? allApps.length
                  : t.value === 'approval'
                    ? allApps.filter((a) => APPROVAL_STATUSES.includes(a.status)).length
                    : t.value === 'denied'
                      ? allApps.filter((a) => DENIED_STATUSES.includes(a.status)).length
                      : allApps.filter((a) => a.status === t.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        onRowClick={(a) => navigate(`/applications/${a.id}`)}
        emptyMessage="No applications found"
      />
    </div>
  );
}
