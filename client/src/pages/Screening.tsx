import { useState } from 'react';
import { Search, Play, AlertTriangle, CheckCircle, Clock, FileText, ShieldAlert, ArrowLeft } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { api } from '@/api/client';
import {
  hasMinRole,
  type Application,
  type ApplicationListResponse,
  type ScreeningResult,
  type FraudFlag,
  type ReviewQueueItem,
  type ReviewQueueResponse,
  type AdverseActionDraft,
} from '@/types';

const columns: Column<Application>[] = [
  { key: 'name', header: 'Applicant', render: (r) => `${r.first_name} ${r.last_name}` },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'unit_number', header: 'Unit' },
  { key: 'annual_income', header: 'Income', className: 'text-right', render: (r) => r.annual_income != null ? `$${r.annual_income.toLocaleString()}` : '—' },
  { key: 'created_at', header: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString() },
];

// Review-queue rows surface each check's verdict so the reviewer can see WHY the
// application is held (typically the vendor checks came back could_not_screen).
const reviewColumns: Column<ReviewQueueItem>[] = [
  { key: 'name', header: 'Applicant', render: (r) => `${r.first_name} ${r.last_name}` },
  { key: 'identity', header: 'Identity', render: (r) => <StatusBadge status={r.identity_verification_result} /> },
  { key: 'background', header: 'Background', render: (r) => <StatusBadge status={r.background_check_result} /> },
  { key: 'credit', header: 'Credit', render: (r) => <StatusBadge status={r.credit_check_result} /> },
  { key: 'compliance', header: 'Compliance', render: (r) => <StatusBadge status={r.compliance_check_result} /> },
  { key: 'held', header: 'Held Since', render: (r) => new Date(r.created_at).toLocaleDateString() },
];

export function Screening() {
  const { user } = useAuth();
  const { data, loading, refetch } = useApiQuery<ApplicationListResponse>('/api/applications');
  const { data: reviewData, loading: reviewLoading, error: reviewError, refetch: refetchReview } =
    useApiQuery<ReviewQueueResponse>('/api/screening/review-queue');
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [results, setResults] = useState<ScreeningResult | null>(null);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolveApp, setResolveApp] = useState<ReviewQueueItem | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [tab, setTab] = useState<'queue' | 'review' | 'completed'>('queue');
  // Deny preview-then-confirm flow. The denial isn't committed until the staffer
  // confirms the §1681m notice the server drafted — the client never sends it.
  const [adverseDraft, setAdverseDraft] = useState<AdverseActionDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  if (!user || !hasMinRole(user.role, 'senior_manager')) {
    return <p className="text-sm text-red-600">Access denied. Senior Manager or above required.</p>;
  }

  const allApps = data?.applications || [];
  const queue = allApps.filter((a) => a.status === 'submitted');
  const completed = allApps.filter((a) => ['screening_passed', 'screening_failed'].includes(a.status));
  const review = reviewData?.queue || [];

  async function runScreening(app: Application) {
    setActionLoading(true);
    try {
      const res = await api.post<ScreeningResult>(`/api/screening/${app.id}/screen`);
      setResults(res);
      refetch();
      refetchReview();
    } finally {
      setActionLoading(false);
    }
  }

  async function viewResults(app: Application) {
    setSelectedApp(app);
    setActionLoading(true);
    try {
      const [res, flags] = await Promise.all([
        api.get<ScreeningResult>(`/api/screening/${app.id}/results`),
        api.get<{ flags: FraudFlag[] }>(`/api/screening/${app.id}/fraud-flags`),
      ]);
      setResults(res);
      setFraudFlags(flags.flags || []);
    } catch {
      setResults(null);
      setFraudFlags([]);
    } finally {
      setActionLoading(false);
    }
  }

  async function resolveFlag(flagId: string) {
    if (!resolveNotes.trim()) return;
    await api.post(`/api/screening/fraud-flags/${flagId}/resolve`, { notes: resolveNotes });
    setResolveNotes('');
    if (selectedApp) viewResults(selectedApp);
  }

  function closeResolveModal() {
    setResolveApp(null);
    setReviewNotes('');
    setAdverseDraft(null);
    setDraftError(null);
  }

  // Step 1 of the deny flow: do NOT commit. Ask the server to draft the §1681m
  // adverse-action letter so the staffer can read exactly what the applicant will
  // receive before they confirm. The notes become the reasonDetail in the notice.
  async function previewDenial() {
    if (!resolveApp || !reviewNotes.trim()) return;
    setDraftLoading(true);
    setDraftError(null);
    try {
      const res = await api.get<{ draft: AdverseActionDraft }>(
        `/api/screening/${resolveApp.id}/adverse-action/draft?reasonDetail=${encodeURIComponent(reviewNotes.trim())}`
      );
      setAdverseDraft(res.draft);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to draft notice');
    } finally {
      setDraftLoading(false);
    }
  }

  // Manual override of a held (screening_review) application. A "pass" releases it
  // to screening_passed; a "fail" denies it (screening_failed) and the server
  // fires the FCRA adverse-action notice — so a denial requires notes AND a
  // confirmed preview (the deny path is only reachable after previewDenial()).
  async function resolveReview(decision: 'pass' | 'fail') {
    if (!resolveApp) return;
    if (decision === 'fail' && !reviewNotes.trim()) return;
    setActionLoading(true);
    try {
      await api.post(`/api/screening/${resolveApp.id}/review-resolve`, {
        decision,
        notes: reviewNotes.trim(),
      });
      closeResolveModal();
      refetchReview();
      refetch();
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Search} title="Screening" description="Run background, credit, and compliance checks" />

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        <button onClick={() => setTab('queue')} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'queue' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Queue <span className="ml-1 text-xs text-gray-400">{queue.length}</span>
        </button>
        <button onClick={() => setTab('review')} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'review' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Review
          <span className={`ml-1 rounded-full px-1.5 text-xs ${review.length > 0 ? 'bg-amber-100 text-amber-700' : 'text-gray-400'}`}>{review.length}</span>
        </button>
        <button onClick={() => setTab('completed')} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'completed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Completed <span className="ml-1 text-xs text-gray-400">{completed.length}</span>
        </button>
      </div>

      {tab === 'queue' && (
        <DataTable
          columns={[
            ...columns,
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); runScreening(r); }}
                  loading={actionLoading}
                >
                  <Play className="h-3 w-3" /> Screen
                </Button>
              ),
            },
          ]}
          data={queue}
          loading={loading}
          emptyMessage="No applications awaiting screening"
        />
      )}

      {tab === 'review' && (
        <DataTable
          columns={[
            ...reviewColumns,
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setResolveApp(r); setReviewNotes(''); setAdverseDraft(null); setDraftError(null); }}
                >
                  Resolve
                </Button>
              ),
            },
          ]}
          data={review}
          loading={reviewLoading}
          error={reviewError}
          emptyMessage="No applications held for review"
        />
      )}

      {tab === 'completed' && (
        <DataTable
          columns={columns}
          data={completed}
          loading={loading}
          onRowClick={(a) => viewResults(a)}
          emptyMessage="No completed screenings"
        />
      )}

      {/* Results Modal */}
      <Modal open={!!selectedApp} onClose={() => { setSelectedApp(null); setResults(null); }} title={selectedApp ? `Screening: ${selectedApp.first_name} ${selectedApp.last_name}` : ''} wide>
        {actionLoading ? (
          <div className="flex justify-center p-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" /></div>
        ) : results ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {results.overallResult === 'pass' ? <CheckCircle className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
              <span className="text-lg font-medium">Overall: <StatusBadge status={results.overallResult} /></span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ResultCard label="Background" status={results.background.status} />
              <ResultCard label="Credit" status={results.credit.status} score={results.credit.score} />
              <ResultCard label="Compliance" status={results.compliance.status} qualified={results.compliance.amiQualified} />
            </div>

            {fraudFlags.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-red-600 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" /> Fraud Flags ({fraudFlags.length})
                </h3>
                {fraudFlags.map((f) => (
                  <div key={f.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{f.flag_type.replace(/_/g, ' ')}</span>
                      <StatusBadge status={f.resolved_at ? 'pass' : f.severity} />
                    </div>
                    <p className="mt-1 text-gray-600">{f.description}</p>
                    {!f.resolved_at && hasMinRole(user!.role, 'regional_manager') && (
                      <div className="mt-2 flex gap-2">
                        <input
                          placeholder="Resolution notes..."
                          value={resolveNotes}
                          onChange={(e) => setResolveNotes(e.target.value)}
                          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => resolveFlag(f.id)}
                        >
                          Resolve
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-500">No screening results available</p>
        )}
      </Modal>

      {/* Review-resolve Modal — manual override of a held application */}
      <Modal
        open={!!resolveApp}
        onClose={closeResolveModal}
        title={resolveApp ? `Resolve Review: ${resolveApp.first_name} ${resolveApp.last_name}` : ''}
        wide
      >
        {resolveApp && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Held in <StatusBadge status="screening_review" /> since{' '}
                {new Date(resolveApp.created_at).toLocaleString()} — the screening pipeline
                could not produce an automated verdict. Review the per-check results and record
                a manual decision. A denial sends an FCRA adverse-action notice.
              </p>
            </div>

            {adverseDraft ? (
              /* ── Step 2: §1681m notice preview before confirming the denial ── */
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>This notice will be sent to the applicant on confirm.</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-medium text-gray-600">
                    <span>Applicant: {adverseDraft.applicantName}</span>
                    <span>Property: {adverseDraft.propertyName}</span>
                  </div>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans leading-relaxed text-gray-800">
                    {adverseDraft.noticeText}
                  </pre>
                </div>
                <div className="flex justify-between gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actionLoading}
                    onClick={() => { setAdverseDraft(null); setDraftError(null); }}
                  >
                    <ArrowLeft className="h-3 w-3" /> Back
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" disabled={actionLoading} onClick={closeResolveModal}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={actionLoading}
                      onClick={() => resolveReview('fail')}
                    >
                      <AlertTriangle className="h-3 w-3" /> Confirm denial &amp; send notice
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* ── Step 1: per-check detail review + decision entry ── */
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckDetailCard
                    label="Identity"
                    status={resolveApp.identity_verification_result}
                    completedAt={resolveApp.identity_verification_completed_at}
                    summary={summarizeIdentity(resolveApp.identity_verification_details)}
                    details={resolveApp.identity_verification_details}
                  />
                  <CheckDetailCard
                    label="Background"
                    status={resolveApp.background_check_result}
                    completedAt={resolveApp.background_check_completed_at}
                    summary={summarizeBackground(resolveApp.background_check_details)}
                    details={resolveApp.background_check_details}
                  />
                  <CheckDetailCard
                    label="Credit"
                    status={resolveApp.credit_check_result}
                    completedAt={resolveApp.credit_check_completed_at}
                    summary={summarizeCredit(resolveApp.credit_check_details)}
                    details={resolveApp.credit_check_details}
                  />
                  <CheckDetailCard
                    label="Compliance"
                    status={resolveApp.compliance_check_result}
                    completedAt={resolveApp.compliance_check_completed_at}
                    summary={summarizeCompliance(resolveApp.compliance_check_details)}
                    details={resolveApp.compliance_check_details}
                  />
                </div>

                <HudCriminalReference />

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Resolution notes <span className="font-normal text-gray-400">(required to deny)</span>
                  </label>
                  <textarea
                    value={reviewNotes}
                    disabled={actionLoading || draftLoading}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={3}
                    placeholder="Reason for the decision — recorded in the compliance audit trail…"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>

                {draftError && (
                  <p className="text-sm text-red-600">
                    Couldn't draft the notice: {draftError}. Adjust the notes and click Deny… to retry.
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" disabled={actionLoading || draftLoading} onClick={closeResolveModal}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={draftLoading}
                    disabled={!reviewNotes.trim() || actionLoading}
                    onClick={previewDenial}
                  >
                    <AlertTriangle className="h-3 w-3" /> Deny…
                  </Button>
                  <Button variant="primary" size="sm" loading={actionLoading} disabled={actionLoading || draftLoading} onClick={() => resolveReview('pass')}>
                    <CheckCircle className="h-3 w-3" /> Approve
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function ResultCard({ label, status, score, qualified }: { label: string; status: string; score?: number; qualified?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <StatusBadge status={status} />
      {score !== undefined && <p className="mt-1 text-xs text-gray-400">Score: {score}</p>}
      {qualified !== undefined && <p className="mt-1 text-xs text-gray-400">AMI Qualified: {qualified ? 'Yes' : 'No'}</p>}
    </div>
  );
}

// ── Detail-aware per-check card ───────────────────────────────────────────────
// Surfaces the status badge plus a human-readable summary of the vendor *_details
// payload. could_not_screen gets a prominent banner (the whole reason the app is
// held). A collapsible raw view is offered as a fallback for unmapped shapes.
function CheckDetailCard({
  label,
  status,
  completedAt,
  summary,
  details,
}: {
  label: string;
  status: string | null | undefined;
  completedAt?: string | null;
  summary: string[];
  details?: Record<string, unknown> | null;
}) {
  const couldNotScreen = status === 'could_not_screen';
  const errorText = couldNotScreen ? extractError(details) : null;
  const hasRaw = details != null && Object.keys(details).length > 0;

  return (
    <div className={`rounded-lg border p-3 text-left ${couldNotScreen ? 'border-orange-300 bg-orange-50' : 'border-gray-200'}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <StatusBadge status={status ?? ''} />
      </div>

      {couldNotScreen && (
        <div className="mb-2 flex items-start gap-1.5 rounded border border-orange-200 bg-white/70 p-2 text-xs text-orange-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-semibold">Vendor could not produce a verdict</p>
            {errorText && <p className="mt-0.5 text-orange-700">{errorText}</p>}
          </div>
        </div>
      )}

      {summary.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-gray-700">
          {summary.map((line, i) => (
            <li key={i} className="leading-snug">{line}</li>
          ))}
        </ul>
      ) : (
        !couldNotScreen && <p className="text-xs text-gray-400">No detail reported.</p>
      )}

      {completedAt && (
        <p className="mt-1.5 text-[11px] text-gray-400">Completed {new Date(completedAt).toLocaleString()}</p>
      )}

      {hasRaw && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600">Raw detail</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600">
            {JSON.stringify(details, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── Defensive detail extractors ───────────────────────────────────────────────
// Vendor payloads are untyped and shapes vary. Each helper coerces the few fields
// it knows about and silently skips anything missing — never throws on a null or a
// surprise shape. Returns a list of readable summary lines (possibly empty).

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// Pull a human-readable error/reason out of a could_not_screen payload.
function extractError(details?: Record<string, unknown> | null): string | null {
  const d = asRecord(details);
  if (!d) return null;
  for (const k of ['error', 'errorMessage', 'message', 'reason', 'detail', 'failureReason', 'vendorMessage']) {
    const v = str(d[k]);
    if (v) return v;
  }
  return null;
}

function summarizeIdentity(details?: Record<string, unknown> | null): string[] {
  const d = asRecord(details);
  if (!d) return [];
  const out: string[] = [];
  const confidence = num(d.confidence) ?? num(d.confidenceScore);
  if (confidence != null) out.push(`Confidence: ${confidence <= 1 ? `${Math.round(confidence * 100)}%` : confidence}`);
  const liveness = num(d.livenessScore) ?? num(d.liveness);
  if (liveness != null) out.push(`Liveness: ${liveness <= 1 ? `${Math.round(liveness * 100)}%` : liveness}`);
  const idType = str(d.idType) ?? str(d.documentType) ?? str(d.docType);
  if (idType) out.push(`ID type: ${idType}`);
  const match = str(d.matchResult) ?? str(d.verificationResult);
  if (match) out.push(`Match: ${match}`);
  return out;
}

function summarizeBackground(details?: Record<string, unknown> | null): string[] {
  const d = asRecord(details);
  if (!d) return [];
  const out: string[] = [];
  const charges = Array.isArray(d.charges) ? d.charges : null;
  if (charges) {
    out.push(`Charges: ${charges.length}`);
    charges.slice(0, 4).forEach((c) => {
      const cr = asRecord(c);
      const desc = cr ? (str(cr.description) ?? str(cr.charge) ?? str(cr.offense)) : str(c);
      const disp = cr ? str(cr.disposition) : null;
      if (desc) out.push(`• ${desc}${disp ? ` (${disp})` : ''}`);
    });
    if (charges.length > 4) out.push(`…and ${charges.length - 4} more`);
  }
  const flags = Array.isArray(d.flags) ? d.flags : null;
  if (flags && flags.length) {
    out.push(`Flags: ${flags.map((f) => str(asRecord(f)?.type) ?? str(f)).filter(Boolean).join(', ') || flags.length}`);
  }
  const message = str(d.message) ?? str(d.summary);
  if (message) out.push(message);
  return out;
}

function summarizeCredit(details?: Record<string, unknown> | null): string[] {
  const d = asRecord(details);
  if (!d) return [];
  const out: string[] = [];
  const score = num(d.score) ?? num(d.creditScore);
  if (score != null) out.push(`Score: ${score}`);
  const derogCount = num(d.derogatoryCount) ?? (Array.isArray(d.derogatory) ? d.derogatory.length : null);
  if (derogCount != null) out.push(`Derogatory items: ${derogCount}`);
  const derogSummary = str(d.derogatorySummary) ?? str(d.summary);
  if (derogSummary) out.push(derogSummary);
  const collections = num(d.collections);
  if (collections != null) out.push(`Collections: ${collections}`);
  return out;
}

function summarizeCompliance(details?: Record<string, unknown> | null): string[] {
  const d = asRecord(details);
  if (!d) return [];
  const out: string[] = [];
  const matched = d.matched ?? d.matchFound ?? d.hit;
  if (typeof matched === 'boolean') out.push(matched ? 'List match found' : 'No list match');
  const lists = Array.isArray(d.matchedLists) ? d.matchedLists : (Array.isArray(d.lists) ? d.lists : null);
  if (lists && lists.length) {
    out.push(`Matched lists: ${lists.map((l) => str(asRecord(l)?.name) ?? str(l)).filter(Boolean).join(', ') || lists.length}`);
  }
  const listName = str(d.matchedList) ?? str(d.listName);
  if (listName) out.push(`List: ${listName}`);
  const message = str(d.message) ?? str(d.summary);
  if (message) out.push(message);
  return out;
}

// ── HUD criminal-records decision reference ───────────────────────────────────
// Static guardrail content for staffers making a discretionary denial. Collapsed
// by default so it never crowds the per-check review.
function HudCriminalReference() {
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-gray-700">
        <FileText className="h-4 w-4 text-gray-500" /> HUD criminal decision reference
      </summary>
      <div className="space-y-3 border-t border-gray-200 px-3 py-3 text-xs leading-relaxed text-gray-700">
        <div>
          <p className="font-semibold text-gray-900">Mandatory denials</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Lifetime sex-offender registrant</li>
            <li>Methamphetamine manufacture on assisted property</li>
            <li>Current illegal drug use</li>
            <li>Drug-related eviction (3-yr lookback)</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-gray-900">Lookback windows</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Felony violent / sexual / arson: 5–7 yrs post-release</li>
            <li>Felony non-violent: 5 yrs</li>
            <li>Misdemeanor violent: 3 yrs</li>
            <li>Misdemeanor non-violent: 1–3 yrs</li>
            <li>Drug-related non-meth: 3-yr floor (5 yrs distribution)</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-gray-900">Individualized assessment</p>
          <p className="mt-0.5 text-gray-500">Required for discretionary categories.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Nature / severity — must show demonstrable risk to safety or property; generic claims are insufficient</li>
            <li>Time elapsed since conduct</li>
            <li>Mitigating evidence: rehab, employment, references, tenancy record, age at offense, misidentification</li>
          </ul>
        </div>
        <div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 p-2 text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <span className="font-semibold">Never</span> deny on arrest-only or a pending/open charge (no conviction) —
            indefensible under FHA §100.500.
          </p>
        </div>
        <div>
          <p className="font-semibold text-gray-900">Before denial</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Notify the applicant of the specific record</li>
            <li>Allow mitigating evidence</li>
            <li>Document the 3-factor assessment</li>
            <li>Retain the file ≥3 yrs</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
