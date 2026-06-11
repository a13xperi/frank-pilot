import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { ResponsiveCards } from '@/components/ResponsiveCards';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/Button';
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
  {
    key: 'property_name',
    header: 'Property',
    render: (r) => r.property_name ?? '—',
  },
  {
    key: 'unit_number',
    header: 'Unit',
    render: (r) => (
      <span className="font-mono text-xs text-gray-600">{r.unit_number ?? '—'}</span>
    ),
  },
  {
    key: 'household_size',
    header: 'Household',
    className: 'text-right',
    render: (r) => (
      <span className="font-mono text-xs tabular-nums">{r.household_size ?? '—'}</span>
    ),
  },
  {
    key: 'annual_income',
    header: 'Income',
    className: 'text-right',
    render: (r) => (
      <span className="font-mono text-xs tabular-nums">
        {r.annual_income != null ? `$${r.annual_income.toLocaleString()}` : '—'}
      </span>
    ),
  },
  {
    key: 'qualifying_ami_tier',
    header: 'AMI Tier',
    className: 'text-center',
    render: (r) => (
      <span className="font-mono text-xs tabular-nums">
        {r.qualifying_ami_tier ? `${r.qualifying_ami_tier}% AMI` : '—'}
      </span>
    ),
  },
  {
    key: 'created_at',
    header: 'Created',
    render: (r) => (
      <span className="font-mono text-xs tabular-nums text-gray-500">
        {new Date(r.created_at).toLocaleDateString()}
      </span>
    ),
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
          <Button onClick={() => navigate('/applications/new')} variant="primary">
            <Plus className="h-4 w-4" /> New Application
          </Button>
        }
      />

      <div className="inline-flex flex-wrap gap-0.5 rounded-lg border border-gray-200 bg-gray-100 p-0.5">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors duration-100 ${
              tab === t.value
                ? 'border-gray-200 bg-white text-gray-900 shadow-sm'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.label}
            {!loading && (
              <span className="ml-1.5 font-mono text-[10px] tabular-nums text-gray-400">
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

      {/* Table at md+, stacked cards below md (same columns + data + handler). */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          onRowClick={(a) => navigate(`/applications/${a.id}`)}
          emptyMessage="No applications found"
        />
      </div>
      <ResponsiveCards
        className="md:hidden"
        columns={columns}
        data={filtered}
        loading={loading}
        onRowClick={(a) => navigate(`/applications/${a.id}`)}
        emptyMessage="No applications found"
      />
    </div>
  );
}
