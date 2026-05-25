import { useState } from 'react';
import { Search, Play, AlertTriangle, CheckCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { api } from '@/api/client';
import { hasMinRole, type Application, type ApplicationListResponse, type ScreeningResult, type FraudFlag } from '@/types';

const columns: Column<Application>[] = [
  { key: 'name', header: 'Applicant', render: (r) => `${r.first_name} ${r.last_name}` },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  { key: 'unit_number', header: 'Unit' },
  { key: 'annual_income', header: 'Income', className: 'text-right', render: (r) => r.annual_income != null ? `$${r.annual_income.toLocaleString()}` : '—' },
  { key: 'created_at', header: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString() },
];

export function Screening() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, refetch } = useApiQuery<ApplicationListResponse>('/api/applications');
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [results, setResults] = useState<ScreeningResult | null>(null);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [resolveNotes, setResolveNotes] = useState('');
  const [tab, setTab] = useState<'queue' | 'completed'>('queue');

  if (!user || !hasMinRole(user.role, 'senior_manager')) {
    return <p className="text-sm text-red-600">Access denied. Senior Manager or above required.</p>;
  }

  const allApps = data?.applications || [];
  const queue = allApps.filter((a) => a.status === 'submitted');
  const completed = allApps.filter((a) => ['screening_passed', 'screening_failed'].includes(a.status));

  async function runScreening(app: Application) {
    setActionLoading(true);
    try {
      const res = await api.post<ScreeningResult>(`/api/screening/${app.id}/screen`);
      setResults(res);
      toast.success('Screening completed');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Screening failed');
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
    try {
      await api.post(`/api/screening/fraud-flags/${flagId}/resolve`, { notes: resolveNotes });
      toast.success('Fraud flag resolved');
      setResolveNotes('');
      if (selectedApp) viewResults(selectedApp);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve fraud flag');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={Search} title="Screening" description="Run background, credit, and compliance checks" />

      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        <button onClick={() => setTab('queue')} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'queue' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Queue <span className="ml-1 text-xs text-gray-400">{queue.length}</span>
        </button>
        <button onClick={() => setTab('completed')} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === 'completed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Completed <span className="ml-1 text-xs text-gray-400">{completed.length}</span>
        </button>
      </div>

      {tab === 'queue' ? (
        <DataTable
          columns={[
            ...columns,
            {
              key: 'actions',
              header: '',
              render: (r) => (
                <Button
                  size="sm"
                  loading={actionLoading}
                  onClick={(e) => { e.stopPropagation(); runScreening(r); }}
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
      ) : (
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
