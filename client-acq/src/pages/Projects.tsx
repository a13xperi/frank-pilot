import { useState, type ReactNode } from 'react';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Target,
  X,
  MapPin,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/api/client';
import {
  type AcqProject,
  type ProjectInput,
  type ProjectScore,
  type ScoredProject,
  type GeographicAccount,
  type SetAsideAccount,
  type ElectionKind,
  type ResidentService,
  GEO_LABELS,
  SET_ASIDE_LABELS,
  ELECTION_LABELS,
  RESIDENT_SERVICE_OPTIONS,
} from '@/types';

const ACCOUNTS: GeographicAccount[] = ['CLARK', 'WASHOE', 'OTHER'];
const ELECTIONS: ElectionKind[] = ['STD_40_60', 'STD_20_50', 'AVERAGE_INCOME'];
const SET_ASIDES: SetAsideAccount[] = ['NONPROFIT', 'USDA_RD', 'TRIBAL', 'ADDITIONAL'];

export function Projects() {
  const { data, loading, error, refetch } = useApiQuery<{ projects: AcqProject[] }>(
    '/api/acquisitions/projects',
  );
  // `editing` holds 'new', an existing project, or null (closed).
  const [editing, setEditing] = useState<AcqProject | 'new' | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const projects = data?.projects ?? [];

  async function remove(id: string) {
    if (!window.confirm('Delete this candidate project? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.del(`/api/acquisitions/projects/${id}`);
      refetch();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Building2}
        title="Candidate Projects"
        description="Score a candidate LIHTC project against the funnel-relevant QAP subset (§7.4.1/2/3, §7.3.1) and the live §6.1 market-study demand."
        action={
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        }
      />

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Candidate projects</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          </div>
        ) : projects.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-5 py-2 font-medium">Project</th>
                <th className="px-5 py-2 font-medium">Account</th>
                <th className="px-5 py-2 font-medium">Election</th>
                <th className="px-5 py-2 text-right font-medium">Units</th>
                <th className="px-5 py-2 text-right font-medium">Restricted</th>
                <th className="px-5 py-2 font-medium">Siting</th>
                <th className="px-5 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const restricted = p.units30Ami + p.units50Ami + p.units60Ami;
                return (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-gray-900">{p.name}</p>
                      {p.city && <p className="text-xs text-gray-400">{p.city}</p>}
                    </td>
                    <td className="px-5 py-2.5 text-gray-700">{GEO_LABELS[p.geographicAccount]}</td>
                    <td className="px-5 py-2.5 text-gray-700">{ELECTION_LABELS[p.electionKind]}</td>
                    <td className="px-5 py-2.5 text-right text-gray-900">{p.totalUnits}</td>
                    <td className="px-5 py-2.5 text-right text-gray-900">{restricted}</td>
                    <td className="px-5 py-2.5">
                      {p.isQct || p.isDda ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          <MapPin className="h-3 w-3" />
                          {p.isQct && p.isDda ? 'QCT+DDA' : p.isQct ? 'QCT' : 'DDA'}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Score" onClick={() => setScoringId(p.id)}>
                          <Target className="h-4 w-4" />
                        </IconButton>
                        <IconButton title="Edit" onClick={() => setEditing(p)}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          title="Delete"
                          onClick={() => remove(p.id)}
                          disabled={deleting === p.id}
                          danger
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-12 text-center text-sm text-gray-400">
            No candidate projects yet. Add one to score it against the QAP subset.
          </p>
        )}
      </div>

      {editing && (
        <ProjectForm
          project={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}

      {scoringId && <ScoreModal projectId={scoringId} onClose={() => setScoringId(null)} />}
    </div>
  );
}

// ── Create / edit form ───────────────────────────────────────────────────────

interface FormState {
  name: string;
  geographicAccount: GeographicAccount;
  city: string;
  setAside: SetAsideAccount | '';
  electionKind: ElectionKind;
  totalUnits: number;
  units30Ami: number;
  units50Ami: number;
  units60Ami: number;
  isQct: boolean;
  isDda: boolean;
  residentServices: ResidentService[];
  notes: string;
}

function toFormState(p: AcqProject | null): FormState {
  return {
    name: p?.name ?? '',
    geographicAccount: p?.geographicAccount ?? 'CLARK',
    city: p?.city ?? '',
    setAside: p?.setAside ?? '',
    electionKind: p?.electionKind ?? 'STD_40_60',
    totalUnits: p?.totalUnits ?? 0,
    units30Ami: p?.units30Ami ?? 0,
    units50Ami: p?.units50Ami ?? 0,
    units60Ami: p?.units60Ami ?? 0,
    isQct: p?.isQct ?? false,
    isDda: p?.isDda ?? false,
    residentServices: p?.residentServices ?? [],
    notes: p?.notes ?? '',
  };
}

function ProjectForm({
  project,
  onClose,
  onSaved,
}: {
  project: AcqProject | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restricted = form.units30Ami + form.units50Ami + form.units60Ami;
  const overcommitted = restricted > form.totalUnits;
  const nameMissing = form.name.trim().length === 0;
  const canSave = !overcommitted && !nameMissing && !saving;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleService(key: ResidentService) {
    setForm((f) => ({
      ...f,
      residentServices: f.residentServices.includes(key)
        ? f.residentServices.filter((s) => s !== key)
        : [...f.residentServices, key],
    }));
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const payload: ProjectInput = {
      name: form.name.trim(),
      geographicAccount: form.geographicAccount,
      city: form.city.trim() || null,
      setAside: form.setAside || null,
      electionKind: form.electionKind,
      totalUnits: form.totalUnits,
      units30Ami: form.units30Ami,
      units50Ami: form.units50Ami,
      units60Ami: form.units60Ami,
      isQct: form.isQct,
      isDda: form.isDda,
      residentServices: form.residentServices,
      notes: form.notes.trim() || null,
    };
    try {
      if (project) {
        await api.put(`/api/acquisitions/projects/${project.id}`, payload);
      } else {
        await api.post('/api/acquisitions/projects', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <Modal title={project ? 'Edit project' : 'New candidate project'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Project name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Desert Vista Apartments"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Geographic account">
            <select
              className="input"
              value={form.geographicAccount}
              onChange={(e) => set('geographicAccount', e.target.value as GeographicAccount)}
            >
              {ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {GEO_LABELS[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="City (optional)">
            <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Set-aside (optional)">
            <select
              className="input"
              value={form.setAside}
              onChange={(e) => set('setAside', e.target.value as SetAsideAccount | '')}
            >
              <option value="">None</option>
              {SET_ASIDES.map((s) => (
                <option key={s} value={s}>
                  {SET_ASIDE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rent/income election (§7.4.2)">
            <select
              className="input"
              value={form.electionKind}
              onChange={(e) => set('electionKind', e.target.value as ElectionKind)}
            >
              {ELECTIONS.map((k) => (
                <option key={k} value={k}>
                  {ELECTION_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
            Unit mix (§7.4.1 — units committed AT each tier)
          </p>
          <div className="grid grid-cols-4 gap-3">
            <NumField label="Total units" value={form.totalUnits} onChange={(v) => set('totalUnits', v)} />
            <NumField label="@ 30% AMI" value={form.units30Ami} onChange={(v) => set('units30Ami', v)} />
            <NumField label="@ 50% AMI" value={form.units50Ami} onChange={(v) => set('units50Ami', v)} />
            <NumField label="@ 60% AMI" value={form.units60Ami} onChange={(v) => set('units60Ami', v)} />
          </div>
          {overcommitted && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              Restricted units ({restricted}) exceed total units ({form.totalUnits}).
            </p>
          )}
        </div>

        <Field label="Location (§7.3.1 / §11 basis boost)">
          <div className="flex gap-5 pt-1">
            <Checkbox label="In a Qualified Census Tract (QCT)" checked={form.isQct} onChange={(v) => set('isQct', v)} />
            <Checkbox label="In a Difficult Development Area (DDA)" checked={form.isDda} onChange={(v) => set('isDda', v)} />
          </div>
        </Field>

        <Field label="Resident services (§7.4.3 — sum of points, capped at 6)">
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5 pt-1">
            {RESIDENT_SERVICE_OPTIONS.map((s) => (
              <Checkbox
                key={s.key}
                label={`${s.label} (${s.points} pt${s.points === 1 ? '' : 's'})`}
                checked={form.residentServices.includes(s.key)}
                onChange={() => toggleService(s.key)}
              />
            ))}
          </div>
        </Field>

        <Field label="Notes (optional)">
          <textarea
            className="input min-h-[64px]"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Field>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

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
            {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Score modal ──────────────────────────────────────────────────────────────

function ScoreModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data, loading, error } = useApiQuery<ScoredProject>(
    `/api/acquisitions/projects/${projectId}/score`,
  );

  return (
    <Modal title={data ? `Score — ${data.project.name}` : 'Score'} onClose={onClose}>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      {data && <ScoreDetail score={data.score} />}
    </Modal>
  );
}

function ScoreDetail({ score }: { score: ProjectScore }) {
  const pct = score.eligibility.subsetPct;
  return (
    <div className="space-y-5">
      {/* Headline: subset score */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Funnel-relevant subset score
            </p>
            <p className="mt-1 text-3xl font-semibold text-gray-900">
              {score.funnelPoints}
              <span className="text-lg text-gray-400"> / {score.funnelMaxPoints} pts</span>
            </p>
          </div>
          <p className="text-2xl font-semibold text-emerald-600">{pct}%</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="mt-2 text-xs text-gray-400">{score.eligibility.note}</p>
      </div>

      {/* Criteria breakdown */}
      <div className="space-y-2">
        {score.criteria.map((c) => (
          <div key={c.key} className="rounded-lg border border-gray-100 p-3">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium text-gray-900">
                <span className="mr-1.5 text-xs text-gray-400">{c.section}</span>
                {c.label}
              </p>
              <p className="text-sm font-semibold text-gray-900">
                {c.points}
                <span className="text-gray-400"> / {c.maxPoints}</span>
              </p>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{c.detail}</p>
          </div>
        ))}
      </div>

      {/* Market study + basis boost */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs font-medium text-gray-600">Market study (§6.1)</p>
          <p
            className={`mt-1 text-xl font-semibold ${
              score.marketStudy.captureRatePct == null
                ? 'text-gray-400'
                : score.marketStudy.meetsThreshold
                  ? 'text-emerald-600'
                  : 'text-amber-600'
            }`}
          >
            {score.marketStudy.captureRatePct == null
              ? '—'
              : `${score.marketStudy.captureRatePct}% capture`}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {score.marketStudy.affordableUnits} affordable units vs {score.marketStudy.qualifiedDemand}{' '}
            qualified applicants · ceiling {score.marketStudy.maxAcceptableCaptureRatePct}%
          </p>
          <StatusChip
            ok={score.marketStudy.meetsThreshold}
            okText="Within capture ceiling"
            badText={
              score.marketStudy.captureRatePct == null ? 'No demand captured yet' : 'Exceeds ceiling'
            }
          />
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs font-medium text-gray-600">Basis boost (§11)</p>
          <p
            className={`mt-1 text-xl font-semibold ${
              score.basisBoost.eligible ? 'text-emerald-600' : 'text-gray-400'
            }`}
          >
            {score.basisBoost.eligible ? `+${score.basisBoost.boostPct}%` : 'None'}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {score.basisBoost.eligible ? 'QCT/DDA siting unlocks the eligible-basis boost.' : 'Requires QCT/DDA siting.'}
          </p>
          <StatusChip ok={score.basisBoost.eligible} okText="Eligible" badText="Not eligible" />
        </div>
      </div>
    </div>
  );
}

// ── Small shared UI ──────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
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

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <input
        type="number"
        min={0}
        className="input"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
      />
      {label}
    </label>
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
      className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {ok ? okText : badText}
    </span>
  );
}
