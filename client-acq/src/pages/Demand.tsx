import { useMemo, useState, type CSSProperties } from 'react';
import { BarChart3, Download, Users, ListChecks, Home, TrendingDown } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import {
  type AmiTier,
  type GeographicAccount,
  type DemandRollup,
  type DemandPacket,
  GEO_LABELS,
  bedroomLabel,
} from '@/types';

const ACCOUNTS: GeographicAccount[] = ['CLARK', 'WASHOE', 'OTHER'];
const TIERS: AmiTier[] = ['30', '50', '60', '80'];
const BEDROOMS = [0, 1, 2, 3, 4];

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&') : '';
}

// Heatmap shading: deeper green as a cell's applicant count rises vs. the
// busiest cell in view. Demand IS the asset, so the eye should land on it.
function heatStyle(value: number, max: number): CSSProperties {
  if (value <= 0 || max <= 0) return {};
  const intensity = Math.min(1, value / max);
  return { backgroundColor: `rgba(5, 150, 105, ${0.08 + intensity * 0.5})` };
}

export function Demand() {
  const [account, setAccount] = useState<GeographicAccount | ''>('');
  const [bedrooms, setBedrooms] = useState<number | ''>('');
  const [tier, setTier] = useState<AmiTier | ''>('');

  const demandPath = `/api/acquisitions/demand${qs({ account, bedrooms, tier })}`;
  const { data: rollup, loading, error } = useApiQuery<DemandRollup>(demandPath);

  const packetAccount: GeographicAccount = account || 'CLARK';
  const { data: packet } = useApiQuery<DemandPacket>(
    `/api/acquisitions/demand/packet${qs({ account: packetAccount })}`,
  );

  const maxDemand = useMemo(
    () => (rollup ? Math.max(0, ...rollup.demand.map((c) => c.qualifiedApplicants)) : 0),
    [rollup],
  );

  function exportPacket() {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `demand-packet-${packet.account.toLowerCase()}-${packet.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Demand Evidence"
        description="AMI-qualified funnel demand by submarket — the market-study evidence the QAP scores (§6.1, §7.4)."
        action={
          <button
            onClick={exportPacket}
            disabled={!packet}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export packet ({GEO_LABELS[packetAccount]})
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className="label">Geographic account</label>
          <select className="input" value={account} onChange={(e) => setAccount(e.target.value as GeographicAccount | '')}>
            <option value="">All Nevada</option>
            {ACCOUNTS.map((a) => (
              <option key={a} value={a}>
                {GEO_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bedrooms</label>
          <select
            className="input"
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Any</option>
            {BEDROOMS.map((b) => (
              <option key={b} value={b}>
                {bedroomLabel(b)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">AMI tier</label>
          <select className="input" value={tier} onChange={(e) => setTier(e.target.value as AmiTier | '')}>
            <option value="">Any</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}% AMI
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      {/* Totals */}
      {rollup && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Users} label="Qualified applicants" value={rollup.totals.qualifiedApplicants} />
          <StatCard icon={ListChecks} label="Waitlist depth" value={rollup.totals.waitlistDepth} />
          <StatCard icon={Home} label="Available units" value={rollup.totals.availableUnits} />
          <StatCard icon={Home} label="Total units" value={rollup.totals.totalUnits} muted />
        </div>
      )}

      {/* Market-study packet */}
      {packet && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Market study — {packet.accountLabel}
            </h2>
            <span className="text-xs text-gray-400">
              generated {new Date(packet.generatedAt).toLocaleString()}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <PacketStat
              icon={TrendingDown}
              label="Capture rate"
              value={packet.marketStudy.captureRatePct == null ? '—' : `${packet.marketStudy.captureRatePct}%`}
              sub={`ceiling ${packet.marketStudy.maxAcceptableCaptureRatePct}% (§6.1)`}
              ok={packet.marketStudy.meetsCaptureThreshold}
            />
            <PacketStat
              icon={Users}
              label="Deep-demand share (≤50% AMI)"
              value={`${packet.demand.deepDemandSharePct}%`}
              sub="low-rent targeting evidence (§7.4.1)"
            />
            <PacketStat
              icon={Home}
              label="Basis boost (§11)"
              value={packet.basisBoost.eligible ? `+${packet.basisBoost.boostPct}%` : 'None'}
              sub={`${packet.basisBoost.qctOrDdaProperties}/${packet.basisBoost.properties} props in QCT/DDA`}
              ok={packet.basisBoost.eligible}
            />
          </div>

          {/* Targeting mix */}
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-gray-700">Targeting mix (share of qualified demand)</p>
            <div className="space-y-1.5">
              {packet.targetingMix.map((t) => (
                <div key={t.tier} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs text-gray-500">{t.tier}% AMI</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-gray-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${t.sharePct}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs text-gray-600">
                    {t.qualifiedApplicants} ({t.sharePct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Demand rollup table */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Demand cells — account × bedroom × tier</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : rollup && rollup.demand.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Account</th>
                <th className="px-5 py-2 font-medium">Bedrooms</th>
                <th className="px-5 py-2 font-medium">AMI tier</th>
                <th className="px-5 py-2 text-right font-medium">Qualified applicants</th>
              </tr>
            </thead>
            <tbody>
              {rollup.demand.map((c) => (
                <tr key={`${c.account}-${c.bedrooms}-${c.tier}`} className="border-b border-gray-50">
                  <td className="px-5 py-2 text-gray-700">{GEO_LABELS[c.account]}</td>
                  <td className="px-5 py-2 text-gray-700">{bedroomLabel(c.bedrooms)}</td>
                  <td className="px-5 py-2 text-gray-700">{c.tier}% AMI</td>
                  <td className="px-5 py-2 text-right font-medium text-gray-900" style={heatStyle(c.qualifiedApplicants, maxDemand)}>
                    {c.qualifiedApplicants}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-12 text-center text-sm text-gray-400">No qualified demand for this filter yet.</p>
        )}
      </div>

      {/* Supply table */}
      {rollup && rollup.supply.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Supply &amp; waitlist — account × bedroom</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Account</th>
                <th className="px-5 py-2 font-medium">Bedrooms</th>
                <th className="px-5 py-2 text-right font-medium">Available</th>
                <th className="px-5 py-2 text-right font-medium">Total units</th>
                <th className="px-5 py-2 text-right font-medium">Waitlist depth</th>
              </tr>
            </thead>
            <tbody>
              {rollup.supply.map((c) => (
                <tr key={`${c.account}-${c.bedrooms}`} className="border-b border-gray-50">
                  <td className="px-5 py-2 text-gray-700">{GEO_LABELS[c.account]}</td>
                  <td className="px-5 py-2 text-gray-700">{bedroomLabel(c.bedrooms)}</td>
                  <td className="px-5 py-2 text-right text-gray-900">{c.availableUnits}</td>
                  <td className="px-5 py-2 text-right text-gray-500">{c.totalUnits}</td>
                  <td className="px-5 py-2 text-right text-gray-900">{c.waitlistDepth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  muted,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-semibold ${muted ? 'text-gray-500' : 'text-gray-900'}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function PacketStat({
  icon: Icon,
  label,
  value,
  sub,
  ok,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub: string;
  ok?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-center gap-2 text-gray-400">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium text-gray-600">{label}</span>
      </div>
      <p className={`mt-1 text-xl font-semibold ${ok === undefined ? 'text-gray-900' : ok ? 'text-emerald-600' : 'text-gray-400'}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-gray-400">{sub}</p>
    </div>
  );
}
