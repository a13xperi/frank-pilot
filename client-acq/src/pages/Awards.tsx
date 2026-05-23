import { useState, useMemo, type ReactNode } from 'react';
import {
  Award,
  Plus,
  Trash2,
  Link2,
  ListChecks,
  X,
  CheckCircle2,
  AlertTriangle,
  Building,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/api/client';
import {
  type AcqAward,
  type AcqProject,
  type AwardCreateInput,
  type AwardStatus,
  type DesignationPlan,
  type BoundUnit,
  type UnitDesignation,
  type PropertyLite,
  AWARD_STATUS_LABELS,
  DESIGNATION_LABELS,
} from '@/types';

const STATUSES: AwardStatus[] = ['reserved', 'placed_in_service', 'in_service', 'closed'];
const DESIGNATIONS: UnitDesignation[] = ['30', '50', '60', 'market'];

export function Awards() {
  const awardsQ = useApiQuery<{ awards: AcqAward[] }>('/api/acquisitions/awards');
  const projectsQ = useApiQuery<{ projects: AcqProject[] }>('/api/acquisitions/projects');
  const propsQ = useApiQuery<{ properties: PropertyLite[] }>('/api/properties');

  const [creating, setCreating] = useState(false);
  const [binding, setBinding] = useState<AcqAward | null>(null);
  const [managing, setManaging] = useState<AcqAward | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const awards = awardsQ.data?.awards ?? [];
  const projects = projectsQ.data?.projects ?? [];
  const properties = propsQ.data?.properties ?? [];

  const projectName = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? '(unknown project)';
  }, [projects]);
  const propertyName = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? '(unknown property)' : null);
  }, [properties]);

  // Projects that don't have an award yet — the create form's candidate list.
  const awardedProjectIds = new Set(awards.map((a) => a.acqProjectId));
  const eligibleProjects = projects.filter((p) => !awardedProjectIds.has(p.id));

  async function remove(id: string) {
    if (!window.confirm('Delete this award? Unit designations already applied are kept.')) return;
    setDeleting(id);
    try {
      await api.del(`/api/acquisitions/awards/${id}`);
      awardsQ.refetch();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Award}
        title="Awards"
        description="Record a won credit reservation, bind it to a managed property, and designate units at their committed AMI tiers (IRC §42 / LURA). Each step is stamped to the compliance tape."
        action={
          <button
            onClick={() => setCreating(true)}
            disabled={eligibleProjects.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            title={eligibleProjects.length === 0 ? 'Every project already has an award' : undefined}
          >
            <Plus className="h-4 w-4" />
            Record award
          </button>
        }
      />

      {awardsQ.error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{awardsQ.error}</p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Awarded projects</h2>
        </div>
        {awardsQ.loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : awards.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Project</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Bound property</th>
                <th className="px-5 py-2 text-right font-medium">Reservation</th>
                <th className="px-5 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {awards.map((a) => (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-gray-900">{projectName(a.acqProjectId)}</p>
                    {a.awardDate && <p className="text-xs text-gray-400">Awarded {a.awardDate}</p>}
                  </td>
                  <td className="px-5 py-2.5">
                    <StatusPill status={a.status} />
                  </td>
                  <td className="px-5 py-2.5 text-gray-700">
                    {a.propertyId ? (
                      <span className="inline-flex items-center gap-1">
                        <Building className="h-3.5 w-3.5 text-gray-400" />
                        {propertyName(a.propertyId)}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">Not bound</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-900">
                    {a.reservationAmount == null
                      ? '—'
                      : `$${a.reservationAmount.toLocaleString()}`}
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton title="Bind property" onClick={() => setBinding(a)}>
                        <Link2 className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        title="Manage designations"
                        onClick={() => setManaging(a)}
                        disabled={!a.propertyId}
                      >
                        <ListChecks className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        title="Delete"
                        onClick={() => remove(a.id)}
                        disabled={deleting === a.id}
                        danger
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-12 text-center text-sm text-gray-400">
            No awards yet. Record one once a candidate project wins a reservation.
          </p>
        )}
      </div>

      {creating && (
        <CreateAwardModal
          projects={eligibleProjects}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            awardsQ.refetch();
          }}
        />
      )}
      {binding && (
        <BindModal
          award={binding}
          properties={properties}
          onClose={() => setBinding(null)}
          onSaved={() => {
            setBinding(null);
            awardsQ.refetch();
          }}
        />
      )}
      {managing && managing.propertyId && (
        <DesignationsModal
          award={managing}
          propertyName={propertyName(managing.propertyId) ?? 'property'}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}

// ── Create award ──────────────────────────────────────────────────────────────

function CreateAwardModal({
  projects,
  onClose,
  onSaved,
}: {
  projects: AcqProject[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [acqProjectId, setAcqProjectId] = useState(projects[0]?.id ?? '');
  const [status, setStatus] = useState<AwardStatus>('reserved');
  const [reservationAmount, setReservationAmount] = useState('');
  const [awardDate, setAwardDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = acqProjectId !== '' && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const payload: AwardCreateInput = {
      acqProjectId,
      status,
      reservationAmount: reservationAmount.trim() ? Number(reservationAmount) : null,
      awardDate: awardDate || null,
      placedInServiceDeadline: deadline || null,
      notes: notes.trim() || null,
    };
    try {
      await api.post('/api/acquisitions/awards', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal title="Record award" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Awarded project">
          <select className="input" value={acqProjectId} onChange={(e) => setAcqProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AwardStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {AWARD_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reservation amount (optional)">
            <input
              type="number"
              min={0}
              className="input"
              value={reservationAmount}
              onChange={(e) => setReservationAmount(e.target.value)}
              placeholder="e.g. 1200000"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Award date (optional)">
            <input type="date" className="input" value={awardDate} onChange={(e) => setAwardDate(e.target.value)} />
          </Field>
          <Field label="Placed-in-service deadline (optional)">
            <input type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea className="input min-h-[64px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <FormActions onClose={onClose} onSubmit={submit} disabled={!canSave} label={saving ? 'Saving…' : 'Record award'} />
      </div>
    </Modal>
  );
}

// ── Bind property ───────────────────────────────────────────────────────────

function BindModal({
  award,
  properties,
  onClose,
  onSaved,
}: {
  award: AcqAward;
  properties: PropertyLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [propertyId, setPropertyId] = useState(award.propertyId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/acquisitions/awards/${award.id}/bind`, {
        propertyId: propertyId || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bind failed');
      setSaving(false);
    }
  }

  return (
    <Modal title="Bind to a managed property" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Binding ties this award to the property it is built and operated as. Designations are applied
          to that property's units.
        </p>
        <Field label="Managed property">
          <select className="input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">— Unbound —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.city ? ` · ${p.city}` : ''}
              </option>
            ))}
          </select>
        </Field>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <FormActions onClose={onClose} onSubmit={submit} disabled={saving} label={saving ? 'Saving…' : 'Save binding'} />
      </div>
    </Modal>
  );
}

// ── Manage designations ─────────────────────────────────────────────────────

function DesignationsModal({
  award,
  propertyName,
  onClose,
}: {
  award: AcqAward;
  propertyName: string;
  onClose: () => void;
}) {
  const compQ = useApiQuery<{ award: AcqAward; plan: DesignationPlan }>(
    `/api/acquisitions/awards/${award.id}/compliance`,
  );
  const unitsQ = useApiQuery<{ units: BoundUnit[] }>(`/api/acquisitions/awards/${award.id}/units`);

  // Local edits: unitId → chosen designation (or null for undesignated).
  const [edits, setEdits] = useState<Record<string, UnitDesignation | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = compQ.data?.plan ?? null;
  const units = unitsQ.data?.units ?? [];
  const loading = compQ.loading || unitsQ.loading;

  function current(u: BoundUnit): UnitDesignation | null {
    return u.id in edits ? edits[u.id] : u.amiDesignation;
  }

  // Only units whose designation actually changed get submitted; the API
  // requires a concrete designation, so null (undesignate) is not sent.
  const changed = units.filter((u) => u.id in edits && edits[u.id] !== u.amiDesignation);
  const sendable = changed.filter((u) => edits[u.id] !== null);
  const hasUnsendableClears = changed.length > sendable.length;

  async function apply() {
    if (sendable.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/acquisitions/awards/${award.id}/designations`, {
        assignments: sendable.map((u) => ({ unitId: u.id, designation: edits[u.id] })),
      });
      setEdits({});
      compQ.refetch();
      unitsQ.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Designations — ${propertyName}`} onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-5">
          {(compQ.error || unitsQ.error) && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {compQ.error || unitsQ.error}
            </p>
          )}

          {plan && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    LURA commitment · {plan.electionLabel}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">{plan.note}</p>
                </div>
                <StatusChip
                  ok={plan.meetsCommitment}
                  okText="Commitment met"
                  badText="Shortfall"
                />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {plan.rows.map((r) => (
                  <div key={r.designation} className="rounded-lg border border-gray-100 bg-white p-2.5 text-center">
                    <p className="text-xs text-gray-500">{DESIGNATION_LABELS[r.designation]}</p>
                    <p className="mt-0.5 text-sm font-semibold text-gray-900">
                      {r.assigned}
                      <span className="text-gray-400"> / {r.committed}</span>
                    </p>
                    {r.remaining > 0 && (
                      <p className="text-xs text-amber-600">{r.remaining} to go</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
              Units ({units.length})
            </p>
            {units.length === 0 ? (
              <p className="rounded-lg border border-gray-100 px-3 py-6 text-center text-sm text-gray-400">
                The bound property has no units.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-3 py-2 font-medium">Unit</th>
                      <th className="px-3 py-2 font-medium">Beds</th>
                      <th className="px-3 py-2 font-medium">Designation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((u) => {
                      const val = current(u);
                      const dirty = u.id in edits && edits[u.id] !== u.amiDesignation;
                      return (
                        <tr key={u.id} className={`border-b border-gray-50 ${dirty ? 'bg-emerald-50/40' : ''}`}>
                          <td className="px-3 py-1.5 font-medium text-gray-900">{u.unitNumber}</td>
                          <td className="px-3 py-1.5 text-gray-500">{u.bedrooms}</td>
                          <td className="px-3 py-1.5">
                            <select
                              className="input py-1 text-sm"
                              value={val ?? ''}
                              onChange={(e) =>
                                setEdits((m) => ({
                                  ...m,
                                  [u.id]: e.target.value ? (e.target.value as UnitDesignation) : null,
                                }))
                              }
                            >
                              <option value="">— Undesignated —</option>
                              {DESIGNATIONS.map((d) => (
                                <option key={d} value={d}>
                                  {DESIGNATION_LABELS[d]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {hasUnsendableClears && (
            <p className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              Clearing a designation back to "Undesignated" isn't supported yet — those rows won't be saved.
            </p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-400">
              {sendable.length > 0 ? `${sendable.length} unit${sendable.length === 1 ? '' : 's'} to apply` : 'No changes'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
              <button
                onClick={apply}
                disabled={sendable.length === 0 || saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Applying…' : 'Apply designations'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Small shared UI ──────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AwardStatus }) {
  const tone =
    status === 'in_service'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'closed'
        ? 'bg-gray-100 text-gray-500'
        : 'bg-blue-50 text-blue-700';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {AWARD_STATUS_LABELS[status]}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function FormActions({
  onClose,
  onSubmit,
  disabled,
  label,
}: {
  onClose: () => void;
  onSubmit: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
      <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={disabled}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg p-1.5 disabled:opacity-40 ${
        danger
          ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function StatusChip({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {ok ? okText : badText}
    </span>
  );
}
