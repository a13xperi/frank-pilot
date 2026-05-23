import { useState, type ReactNode } from 'react';
import { ClipboardList, X, AlertTriangle, CheckCircle2, HelpCircle, Minus } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import {
  type Recertification,
  type RecertIncomeCheck,
  type IncomeVerdict,
  type RecertStatus,
  RECERT_STATUS_LABELS,
  DESIGNATION_LABELS,
  type UnitDesignation,
} from '@/types';

export function Recertifications() {
  const { data, loading, error } = useApiQuery<{ recertifications: Recertification[] }>(
    '/api/recertifications',
  );
  const [checkId, setCheckId] = useState<string | null>(null);
  const [selectedRecert, setSelectedRecert] = useState<Recertification | null>(null);

  const recerts = data?.recertifications ?? [];

  function openCheck(r: Recertification) {
    setCheckId(r.id);
    setSelectedRecert(r);
  }

  function closeCheck() {
    setCheckId(null);
    setSelectedRecert(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Recertifications"
        description="Annual income recertifications for restricted units. View the income-check verdict for each household against the applicable AMI ceiling and 140% AUR threshold."
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">All recertifications</h2>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : recerts.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Tenant</th>
                <th className="px-5 py-2 font-medium">Property</th>
                <th className="px-5 py-2 font-medium">Unit</th>
                <th className="px-5 py-2 font-medium">Designation</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Due Date</th>
                <th className="px-5 py-2 text-right font-medium">Income Check</th>
              </tr>
            </thead>
            <tbody>
              {recerts.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-gray-900">{r.tenantName ?? '—'}</p>
                  </td>
                  <td className="px-5 py-2.5 text-gray-700">{r.propertyName ?? '—'}</td>
                  <td className="px-5 py-2.5 text-gray-700">{r.unitNumber ?? '—'}</td>
                  <td className="px-5 py-2.5">
                    {r.designation ? (
                      <span className="text-gray-700">
                        {DESIGNATION_LABELS[r.designation as UnitDesignation] ?? r.designation}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <RecertStatusPill status={r.status} />
                  </td>
                  <td className="px-5 py-2.5 text-gray-700">
                    {r.dueDate ? formatDate(r.dueDate) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <button
                      onClick={() => openCheck(r)}
                      className="rounded-lg px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      View check
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-12 text-center text-sm text-gray-400">
            No recertifications found.
          </p>
        )}
      </div>

      {checkId && selectedRecert && (
        <IncomeCheckModal
          recertId={checkId}
          tenantName={selectedRecert.tenantName}
          unitNumber={selectedRecert.unitNumber}
          onClose={closeCheck}
        />
      )}
    </div>
  );
}

// ── Income Check Modal ────────────────────────────────────────────────────────

function IncomeCheckModal({
  recertId,
  tenantName,
  unitNumber,
  onClose,
}: {
  recertId: string;
  tenantName: string | null;
  unitNumber: string | null;
  onClose: () => void;
}) {
  const { data, loading, error } = useApiQuery<RecertIncomeCheck>(
    `/api/recertifications/${recertId}/income-check`,
  );

  const title = [tenantName, unitNumber ? `Unit ${unitNumber}` : null]
    .filter(Boolean)
    .join(' · ') || 'Income Check';

  return (
    <Modal title={title} onClose={onClose}>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      {data && <IncomeCheckDetail data={data} onClose={onClose} />}
    </Modal>
  );
}

function IncomeCheckDetail({ data, onClose }: { data: RecertIncomeCheck; onClose: () => void }) {
  const { context, check } = data;
  return (
    <div className="space-y-5">
      {/* Verdict badge */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Income verdict
          </p>
          <p className="mt-1 text-sm text-gray-500">{check.note ?? 'No additional notes.'}</p>
        </div>
        <VerdictBadge verdict={check.verdict} large />
      </div>

      {/* Context grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {context.amiArea && (
          <InfoCell label="AMI Area" value={context.amiArea} />
        )}
        {context.limitYear && (
          <InfoCell label="Limit Year" value={String(context.limitYear)} />
        )}
        {context.designation && (
          <InfoCell
            label="Designation"
            value={
              DESIGNATION_LABELS[context.designation as UnitDesignation] ??
              String(context.designation)
            }
          />
        )}
        {check.ceilingAmiPct != null && (
          <InfoCell label="Income Ceiling" value={`${check.ceilingAmiPct}% AMI`} />
        )}
      </div>

      {/* Income comparison */}
      {(check.householdIncome != null || check.applicableLimit != null) && (
        <div className="rounded-lg border border-gray-100 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
            Income comparison
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500">Household income</p>
              <p className="mt-0.5 text-lg font-semibold text-gray-900">
                {check.householdIncome != null
                  ? `$${check.householdIncome.toLocaleString()}`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Applicable limit</p>
              <p className="mt-0.5 text-lg font-semibold text-gray-900">
                {check.applicableLimit != null
                  ? `$${check.applicableLimit.toLocaleString()}`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">140% AUR threshold</p>
              <p className="mt-0.5 text-lg font-semibold text-gray-900">
                {check.aurThreshold != null
                  ? `$${check.aurThreshold.toLocaleString()}`
                  : '—'}
              </p>
            </div>
          </div>
          {check.pctOfLimit != null && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>% of applicable limit</span>
                <span className="font-medium text-gray-900">{check.pctOfLimit}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full ${pctColor(check.pctOfLimit)}`}
                  style={{ width: `${Math.min(100, check.pctOfLimit)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── Verdict badge ─────────────────────────────────────────────────────────────

export function VerdictBadge({
  verdict,
  large = false,
}: {
  verdict: IncomeVerdict;
  large?: boolean;
}) {
  const { label, className, Icon } = verdictConfig(verdict);
  const size = large ? 'px-3 py-1.5 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${size} ${className}`}
    >
      <Icon className={large ? 'h-4 w-4' : 'h-3 w-3'} />
      {label}
    </span>
  );
}

function verdictConfig(verdict: IncomeVerdict): {
  label: string;
  className: string;
  Icon: React.FC<{ className?: string }>;
} {
  switch (verdict) {
    case 'qualified':
      return {
        label: 'Qualified',
        className: 'bg-emerald-50 text-emerald-700',
        Icon: CheckCircle2,
      };
    case 'over_income_aur':
      return {
        label: 'AUR governs',
        className: 'bg-amber-50 text-amber-700',
        Icon: AlertTriangle,
      };
    case 'over_income':
      return {
        label: 'Over income',
        className: 'bg-red-50 text-red-700',
        Icon: AlertTriangle,
      };
    case 'indeterminate':
      return {
        label: 'Indeterminate',
        className: 'bg-gray-100 text-gray-500',
        Icon: HelpCircle,
      };
    case 'not_restricted':
      return {
        label: 'Not restricted',
        className: 'bg-gray-100 text-gray-600',
        Icon: Minus,
      };
  }
}

function pctColor(pct: number): string {
  if (pct <= 100) return 'bg-emerald-500';
  if (pct <= 140) return 'bg-amber-500';
  return 'bg-red-500';
}

// ── Status pill ───────────────────────────────────────────────────────────────

function RecertStatusPill({ status }: { status: RecertStatus }) {
  const tone =
    status === 'completed'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'overdue'
        ? 'bg-red-50 text-red-700'
        : status === 'in_progress'
          ? 'bg-blue-50 text-blue-700'
          : status === 'waived'
            ? 'bg-gray-100 text-gray-500'
            : 'bg-amber-50 text-amber-700'; // pending
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {RECERT_STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Small shared UI ───────────────────────────────────────────────────────────

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 font-medium text-gray-900">{value}</p>
    </div>
  );
}

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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
