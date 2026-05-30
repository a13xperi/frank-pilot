import { useState } from 'react';
import { Search, Play, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
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

  // Manual override of a held (screening_review) application. A "pass" releases it
  // to screening_passed; a "fail" denies it (screening_failed) and the server
  // fires the FCRA adverse-action notice — so a denial requires notes.
  async function resolveReview(decision: 'pass' | 'fail') {
    if (!resolveApp) return;
    if (decision === 'fail' && !reviewNotes.trim()) return;
    setActionLoading(true);
    try {
      await api.post(`/api/screening/${resolveApp.id}/review-resolve`, {
        decision,
        notes: reviewNotes.trim(),
      });
      setResolveApp(null);
      setReviewNotes('');
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
                  onClick={(e) => { e.stopPropagation(); setResolveApp(r); setReviewNotes(''); }}
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
        onClose={() => { setResolveApp(null); setReviewNotes(''); }}
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

            <div className="grid grid-cols-2 gap-3">
              <ResultCard label="Identity" status={resolveApp.identity_verification_result ?? ''} />
              <ResultCard label="Background" status={resolveApp.background_check_result ?? ''} />
              <ResultCard label="Credit" status={resolveApp.credit_check_result ?? ''} />
              <ResultCard label="Compliance" status={resolveApp.compliance_check_result ?? ''} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Resolution notes <span className="font-normal text-gray-400">(required to deny)</span>
              </label>
              <textarea
                value={reviewNotes}
                disabled={actionLoading}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
                placeholder="Reason for the decision — recorded in the compliance audit trail…"
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={actionLoading} onClick={() => { setResolveApp(null); setReviewNotes(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={actionLoading}
                disabled={!reviewNotes.trim()}
                onClick={() => resolveReview('fail')}
              >
                <AlertTriangle className="h-3 w-3" /> Deny
              </Button>
              <Button variant="primary" size="sm" loading={actionLoading} onClick={() => resolveReview('pass')}>
                <CheckCircle className="h-3 w-3" /> Approve
              </Button>
            </div>
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
