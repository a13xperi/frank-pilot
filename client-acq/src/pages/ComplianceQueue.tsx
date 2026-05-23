import { useState, type ReactNode } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/api/client';
import {
  type AurQueueItem,
  type AurQueueResponse,
  type NauStatus,
  DESIGNATION_LABELS,
  type UnitDesignation,
} from '@/types';
import { VerdictBadge } from './Recertifications';

const PAGE_SIZE = 50;

export function ComplianceQueue() {
  const [propertyFilter, setPropertyFilter] = useState('');
  const [resolveTarget, setResolveTarget] = useState<AurQueueItem | null>(null);

  // Build the query path reactively based on the filter.
  const queryPath = buildPath(propertyFilter);
  const { data, loading, error, refetch } = useApiQuery<AurQueueResponse>(queryPath);

  const queue = data?.queue ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldAlert}
        title="Compliance Queue"
        description="Over-income and AUR-governed households flagged by the annual recertification income check. Resolve Non-Arm's-Length Unit (NAU) findings for households that qualify under the 140% AUR rule."
      />

      {/* Property filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Filter by property</label>
        <input
          type="text"
          className="input max-w-xs"
          placeholder="Property ID or leave blank for all"
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value.trim())}
        />
        {propertyFilter && (
          <button
            onClick={() => setPropertyFilter('')}
            className="text-sm text-gray-400 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Over-income households</h2>
          {!loading && (
            <span className="text-xs text-gray-400">
              {total} household{total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : queue.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Tenant</th>
                <th className="px-5 py-2 font-medium">Property · Unit</th>
                <th className="px-5 py-2 font-medium">Designation</th>
                <th className="px-5 py-2 font-medium">Verdict</th>
                <th className="px-5 py-2 text-right font-medium">Household income</th>
                <th className="px-5 py-2 text-right font-medium">Limit</th>
                <th className="px-5 py-2 text-right font-medium">AUR threshold</th>
                <th className="px-5 py-2 font-medium">NAU</th>
                <th className="px-5 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.recertId} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-gray-900">{item.tenantName ?? '—'}</p>
                  </td>
                  <td className="px-5 py-2.5 text-gray-700">
                    <span>{item.propertyName ?? '—'}</span>
                    {item.unitNumber && (
                      <span className="ml-1 text-gray-400">· {item.unitNumber}</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-gray-700">
                    {item.designation
                      ? DESIGNATION_LABELS[item.designation as UnitDesignation] ?? item.designation
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    <VerdictBadge verdict={item.verdict} />
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-900">
                    {item.householdIncome != null
                      ? `$${item.householdIncome.toLocaleString()}`
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-900">
                    {item.applicableLimit != null
                      ? `$${item.applicableLimit.toLocaleString()}`
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-900">
                    {item.aurThreshold != null
                      ? `$${item.aurThreshold.toLocaleString()}`
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-2.5">
                    <NauStatusPill status={item.nauStatus} />
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {item.verdict === 'over_income' && item.nauStatus === 'open' ? (
                      <button
                        onClick={() => setResolveTarget(item)}
                        className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                      >
                        Resolve NAU
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-12 text-center text-sm text-gray-400">
            {propertyFilter
              ? 'No flagged households for this property.'
              : 'No flagged households in the compliance queue.'}
          </p>
        )}
      </div>

      {resolveTarget && (
        <NauResolveModal
          item={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => {
            setResolveTarget(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ── NAU Resolve Modal ─────────────────────────────────────────────────────────

function NauResolveModal({
  item,
  onClose,
  onResolved,
}: {
  item: AurQueueItem;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [resolvingUnitId, setResolvingUnitId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = resolvingUnitId.trim().length > 0 && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await api.resolveNau(`${item.recertId}`, {
        resolvingUnitId: resolvingUnitId.trim(),
        notes: notes.trim() || null,
      });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed');
      setSaving(false);
    }
  }

  const tenantLabel = [item.tenantName, item.unitNumber ? `Unit ${item.unitNumber}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal title={`Resolve NAU — ${tenantLabel || 'Household'}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Over-income household</p>
          <p className="mt-1 text-xs">
            Household income{' '}
            {item.householdIncome != null ? `$${item.householdIncome.toLocaleString()}` : '(unknown)'}
            {' '}exceeds the applicable limit{' '}
            {item.applicableLimit != null ? `$${item.applicableLimit.toLocaleString()}` : ''}.
            {' '}If a comparable Non-Arm's-Length Unit (NAU) is available, entering its ID marks
            NAU satisfied and removes this household from the queue.
          </p>
        </div>

        <div>
          <label className="label">Resolving unit ID (NAU comparable)</label>
          <input
            type="text"
            className="input"
            placeholder="e.g. unit-uuid-here"
            value={resolvingUnitId}
            onChange={(e) => setResolvingUnitId(e.target.value)}
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-400">
            The unit ID of the non-arm's-length unit used as the NAU comparable.
          </p>
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            className="input min-h-[64px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why this unit satisfies the NAU requirement..."
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Resolving…' : 'Mark NAU resolved'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── NAU status pill ───────────────────────────────────────────────────────────

function NauStatusPill({ status }: { status: NauStatus }) {
  const tone =
    status === 'resolved'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'open'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-gray-100 text-gray-500';
  const label =
    status === 'resolved' ? 'Resolved' : status === 'open' ? 'Open' : 'N/A';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

// ── Small shared UI ───────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function buildPath(propertyFilter: string): string {
  const qs = new URLSearchParams();
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', '0');
  if (propertyFilter) qs.set('propertyId', propertyFilter);
  return `/api/acquisitions/aur-queue?${qs.toString()}`;
}
