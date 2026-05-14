import { Link } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Loader2, AlertCircle, FileText } from 'lucide-react';

interface ApplicationItem {
  id: string;
  status: string;
  property_name?: string;
  unit_number?: string | null;
  requested_rent_amount?: number | null;
  submitted_at?: string | null;
  created_at: string;
}

interface ApplicationsResponse {
  applications: ApplicationItem[];
}

const PIPELINE: string[] = [
  'draft',
  'submitted',
  'screening',
  'tier1_review',
  'tier2_review',
  'tier3_review',
  'lease_generated',
  'onboarded',
];

const TERMINAL_BAD = new Set(['screening_failed', 'tier1_denied', 'tier2_denied', 'tier3_denied', 'cancelled']);

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  screening: 'Screening',
  screening_passed: 'Screening passed',
  screening_failed: 'Screening failed',
  tier1_review: 'Tier 1 Review',
  tier1_approved: 'T1 Approved',
  tier1_denied: 'T1 Denied',
  tier2_review: 'Tier 2 Review',
  tier2_approved: 'T2 Approved',
  tier2_denied: 'T2 Denied',
  tier3_review: 'Tier 3 Review',
  tier3_approved: 'T3 Approved',
  tier3_denied: 'T3 Denied',
  lease_generated: 'Lease Ready',
  onboarded: 'Onboarded',
  cancelled: 'Cancelled',
};

function pipelineIndex(status: string): number {
  const idx = PIPELINE.indexOf(status);
  if (idx !== -1) return idx;
  // Map approval/passed variants to their stage
  if (status.includes('tier1')) return PIPELINE.indexOf('tier1_review');
  if (status.includes('tier2')) return PIPELINE.indexOf('tier2_review');
  if (status.includes('tier3')) return PIPELINE.indexOf('tier3_review');
  if (status.includes('screening')) return PIPELINE.indexOf('screening');
  return -1;
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusPipeline({ status }: { status: string }) {
  const current = pipelineIndex(status);
  const isDenied = TERMINAL_BAD.has(status);

  if (isDenied) {
    return (
      <div className="mt-3 inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
        {STATUS_LABELS[status] ?? status}
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-0.5 overflow-x-auto pb-1">
      {PIPELINE.map((stage, i) => {
        const isCompleted = i < current;
        const isCurrent = i === current;
        const isFuture = i > current;
        return (
          <div key={stage} className="flex items-center">
            <div className={`flex h-6 min-w-[6rem] items-center justify-center rounded-full px-2 text-[10px] font-medium
              ${isCompleted ? 'bg-gray-200 text-gray-500' : ''}
              ${isCurrent ? 'bg-emerald-600 text-white' : ''}
              ${isFuture ? 'bg-gray-100 text-gray-400' : ''}
            `}>
              {STATUS_LABELS[stage] ?? stage}
            </div>
            {i < PIPELINE.length - 1 && (
              <div className={`h-px w-2 shrink-0 ${i < current ? 'bg-gray-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Status() {
  const { data, loading, error } = useApiQuery<ApplicationsResponse>('/applicants/me/applications');

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const applications = data?.applications ?? [];

  if (applications.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <FileText className="h-10 w-10 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-900">No applications yet</h2>
        <p className="text-sm text-gray-500">Start your application to get placed in affordable housing.</p>
        <Link to="/apply" className="btn-primary">Start an application</Link>
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 sm:p-6">
      <h1 className="mb-5 text-xl font-bold text-gray-900">Application Status</h1>

      <div className="space-y-4">
        {applications.map(app => (
          <div key={app.id} className="rounded-xl bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-900">
                  {app.property_name ?? 'Property TBD'}
                </p>
                {app.unit_number && (
                  <p className="text-sm text-gray-500">Unit {app.unit_number}</p>
                )}
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium
                ${TERMINAL_BAD.has(app.status) ? 'bg-red-100 text-red-700' : ''}
                ${app.status === 'onboarded' ? 'bg-emerald-100 text-emerald-700' : ''}
                ${!TERMINAL_BAD.has(app.status) && app.status !== 'onboarded' ? 'bg-gray-100 text-gray-600' : ''}
              `}>
                {STATUS_LABELS[app.status] ?? app.status}
              </span>
            </div>

            <StatusPipeline status={app.status} />

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400">
              {app.requested_rent_amount != null && (
                <span>Requested rent: <strong className="text-gray-600">{fmt(app.requested_rent_amount)}/mo</strong></span>
              )}
              {app.submitted_at ? (
                <span>Submitted: <strong className="text-gray-600">{fmtDate(app.submitted_at)}</strong></span>
              ) : (
                <span>Started: <strong className="text-gray-600">{fmtDate(app.created_at)}</strong></span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
