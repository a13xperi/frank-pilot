import { Landmark, FileCheck2, Building2, Activity, BadgeCheck, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import type { ShowcaseResponse, ShowcaseTapeEvent } from '@/types';
import type { LucideIcon } from 'lucide-react';

function StatCard({ icon: Icon, label, value, loading }: { icon: LucideIcon; label: string; value: string | number; loading?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-emerald-50 p-2">
          <Icon className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">
            {loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-gray-200" /> : value}
          </p>
        </div>
      </div>
    </div>
  );
}

const KIND_STYLES: Record<string, string> = {
  rent_charge: 'bg-gray-100 text-gray-700',
  payment: 'bg-emerald-50 text-emerald-700',
  late_fee: 'bg-amber-50 text-amber-700',
  audit: 'bg-blue-50 text-blue-700',
};

function EventChip({ event }: { event: ShowcaseTapeEvent }) {
  const style = KIND_STYLES[event.kind === 'audit' ? 'audit' : event.label] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block rounded px-2 py-0.5 font-mono text-xs ${style}`}>
      {event.label}
    </span>
  );
}

export function TheLedger() {
  const navigate = useNavigate();
  const { data, loading, error } = useApiQuery<ShowcaseResponse>('/api/ledger/showcase');

  const tapeColumns: Column<ShowcaseTapeEvent>[] = [
    {
      key: 'at',
      header: 'Time',
      render: (e) => <span className="whitespace-nowrap text-gray-500">{new Date(e.at).toLocaleString()}</span>,
    },
    { key: 'label', header: 'Event', render: (e) => <EventChip event={e} /> },
    {
      key: 'who',
      header: 'Who / Unit',
      render: (e) => (
        <span>
          {e.kind === 'ledger' && e.applicationId ? (
            <Link to={`/ledger/${e.applicationId}`} className="text-emerald-700 hover:underline" onClick={(ev) => ev.stopPropagation()}>
              {e.who}
            </Link>
          ) : (
            e.who
          )}
          {e.unitNumber ? <span className="text-gray-400"> · {e.unitNumber}</span> : null}
        </span>
      ),
    },
    { key: 'propertyName', header: 'Property', render: (e) => <span className="text-gray-500">{e.propertyName ?? '—'}</span> },
    {
      key: 'amount',
      header: 'Amount',
      render: (e) =>
        e.amount === null ? (
          <span className="text-gray-300">—</span>
        ) : (
          <span className={e.amount < 0 ? 'text-emerald-700' : 'text-gray-900'}>
            {e.amount < 0 ? '−' : ''}${Math.abs(e.amount).toLocaleString()}
          </span>
        ),
    },
  ];

  const propertyColumns: Column<ShowcaseResponse['byProperty'][number]>[] = [
    { key: 'propertyName', header: 'Property' },
    { key: 'units', header: 'Units on ledger' },
    { key: 'evidenceCount', header: 'Evidence records' },
    {
      key: 'delinquent',
      header: 'Standing',
      render: (p) =>
        p.delinquent > 0 ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{p.delinquent} delinquent</span>
        ) : p.units > 0 ? (
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">current</span>
        ) : (
          <span className="text-gray-300">—</span>
        ),
    },
  ];

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Landmark}
        title="The Ledger"
        description="Every tenant action becomes a time-stamped, tamper-proof, unit-level record."
      />

      <div className="flex flex-wrap gap-2 text-xs">
        {['Append-only', 'Unit-level', 'Role-scoped', 'Third-party verified'].map((chip) => (
          <span key={chip} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
            {chip}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={FileCheck2} label="Evidence records" value={stats?.evidenceRecords?.toLocaleString() ?? '—'} loading={loading} />
        <StatCard icon={Users} label="Units on ledger" value={stats?.unitsOnLedger ?? '—'} loading={loading} />
        <StatCard icon={Building2} label="Properties" value={stats?.properties ?? '—'} loading={loading} />
        <StatCard icon={Activity} label="Events this month" value={stats?.eventsThisMonth ?? '—'} loading={loading} />
        <StatCard icon={BadgeCheck} label="Current rate" value={stats ? `${stats.currentRate}%` : '—'} loading={loading} />
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">The live tape</h2>
        <p className="text-sm text-gray-500">
          The most recent records, newest first — written the moment each event happened. Tenant names open the unit-level file.
        </p>
        <DataTable columns={tapeColumns} data={data?.tape ?? []} loading={loading} error={error} emptyMessage="No events yet — take any action and watch it land here." />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Proof by property</h2>
        <p className="text-sm text-gray-500">Unit-level evidence across the portfolio. Click a row to open the rent ledger.</p>
        <DataTable
          columns={propertyColumns}
          data={data?.byProperty ?? []}
          loading={loading}
          error={error}
          onRowClick={() => navigate('/ledger')}
          emptyMessage="No properties found."
        />
      </section>
    </div>
  );
}
