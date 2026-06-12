import {
  Megaphone,
  Wrench,
  AlertTriangle,
  CalendarClock,
  RotateCcw,
  Home,
  DollarSign,
  Search,
  CheckCircle,
  Phone,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';

type AttentionSeverity = 'high' | 'medium' | 'low';

interface AttentionItem {
  id: string;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
}

interface PropertySnapshot {
  propertyId: string;
  name: string;
  openWorkOrders: number;
  delinquentHouseholds: number;
  pastDueRent: number;
}

interface ManagerBriefingResponse {
  generatedAt: string;
  scope: { global: boolean; propertyCount: number | null };
  kpis: {
    openWorkOrders: number;
    emergencyWorkOrders: number;
    overdueFollowUps: number;
    activeTurns: number;
    delinquentHouseholds: number;
    pastDueRent: number;
  };
  pipeline: {
    screeningReview: number;
    pendingApprovals: number;
    voiceCallbacks: number;
    upcomingRecerts: number;
  };
  attention: AttentionItem[];
  properties: PropertySnapshot[];
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function ManagerBriefing() {
  const { data, loading, error, refetch } = useApiQuery<ManagerBriefingResponse>('/api/manager/briefing');

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Megaphone}
        title="Manager Briefing"
        description="Live operations rollup across your portfolio — straight from the system of record."
        action={
          <Button variant="secondary" size="sm" onClick={refetch} loading={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Operations KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Open work orders" value={data?.kpis.openWorkOrders} icon={Wrench} tone="slate" loading={loading} />
        <Kpi label="Emergencies" value={data?.kpis.emergencyWorkOrders} icon={AlertTriangle} tone="red" loading={loading} />
        <Kpi label="Overdue follow-ups" value={data?.kpis.overdueFollowUps} icon={CalendarClock} tone="amber" loading={loading} />
        <Kpi label="Active turns" value={data?.kpis.activeTurns} icon={RotateCcw} tone="slate" loading={loading} />
        <Kpi label="Delinquent households" value={data?.kpis.delinquentHouseholds} icon={Home} tone="amber" loading={loading} />
        <Kpi label="Past-due rent" value={data ? usd(data.kpis.pastDueRent) : undefined} icon={DollarSign} tone="red" loading={loading} />
      </div>

      {/* Pipeline — the work Meridian's RealPage overlay can't see */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Pipeline</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Screening review" value={data?.pipeline.screeningReview} icon={Search} tone="indigo" loading={loading} />
          <Kpi label="Awaiting approval" value={data?.pipeline.pendingApprovals} icon={CheckCircle} tone="indigo" loading={loading} />
          <Kpi label="Voice callbacks" value={data?.pipeline.voiceCallbacks} icon={Phone} tone="emerald" loading={loading} />
          <Kpi label="Recerts ≤ 60 days" value={data?.pipeline.upcomingRecerts} icon={CalendarClock} tone="emerald" loading={loading} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Items needing manager attention */}
        <div className="lg:col-span-3 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Items needing your attention
          </h2>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : !data || data.attention.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Nothing flagged — portfolio is clear. ✅
            </p>
          ) : (
            <ul className="space-y-2">
              {data.attention.map((item) => (
                <li key={item.id} className="flex items-start gap-3 rounded-lg border border-gray-100 p-3">
                  <SeverityPill severity={item.severity} />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{item.title}</p>
                    <p className="truncate text-sm text-gray-500">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Property snapshot */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Home className="h-5 w-5 text-emerald-600" />
            Property snapshot
          </h2>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : !data || data.properties.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No properties in scope.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Property</th>
                    <th className="px-2 py-2 text-right font-medium" title="Open work orders">WO</th>
                    <th className="px-2 py-2 text-right font-medium" title="Delinquent households">Delq</th>
                    <th className="px-3 py-2 text-right font-medium">Past due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.properties.map((p) => (
                    <tr key={p.propertyId}>
                      <td className="px-3 py-2 font-medium text-gray-800">{p.name}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600">{p.openWorkOrders}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600">{p.delinquentHouseholds}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.pastDueRent > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}`}>
                        {usd(p.pastDueRent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {data && (
        <p className="text-xs text-gray-400">
          {data.scope.global
            ? 'Portfolio-wide view.'
            : `Scoped to ${data.scope.propertyCount} ${data.scope.propertyCount === 1 ? 'property' : 'properties'}.`}{' '}
          Generated {new Date(data.generatedAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}

type Tone = 'slate' | 'red' | 'amber' | 'indigo' | 'emerald';

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number | string | undefined;
  icon: LucideIcon;
  tone: Tone;
  loading?: boolean;
}) {
  const tones: Record<Tone, string> = {
    slate: 'text-gray-500',
    red: 'text-red-500',
    amber: 'text-amber-500',
    indigo: 'text-indigo-500',
    emerald: 'text-emerald-500',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <Icon className={`h-4 w-4 ${tones[tone]}`} />
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">
        {loading || value === undefined ? (
          <span className="inline-block h-7 w-12 animate-pulse rounded bg-gray-200" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function SeverityPill({ severity }: { severity: AttentionSeverity }) {
  const styles: Record<AttentionSeverity, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`mt-0.5 inline-block flex-none rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[severity]}`}>
      {severity}
    </span>
  );
}
