import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, XCircle, CheckCircle, FileText, Home, AlertTriangle, RefreshCw } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { ApplicationMessages } from '@/components/ApplicationMessages';
import { api } from '@/api/client';
import type { Application, ApprovalStatus, ScreeningResult, LeaseStatus, AdverseActionNotice } from '@/types';

const DENIED_STATUSES = new Set(['screening_failed', 'tier1_denied', 'tier2_denied', 'tier3_denied']);
const POST_SCREENING_STATUSES = new Set([
  'screening_passed', 'tier1_review', 'tier1_approved', 'tier2_review', 'tier2_approved',
  'tier3_review', 'tier3_approved', 'lease_generated', 'onboarded',
]);

export function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: app, loading, error, refetch } = useApiQuery<Application>(id ? `/api/applications/${id}` : null);
  const { data: approvalStatus } = useApiQuery<ApprovalStatus>(id ? `/api/approvals/${id}/status` : null);
  const { data: screening } = useApiQuery<ScreeningResult>(
    app && !['draft', 'submitted'].includes(app.status) ? `/api/screening/${id}/results` : null
  );
  const { data: leaseStatus, refetch: refetchLease } = useApiQuery<LeaseStatus>(
    app && POST_SCREENING_STATUSES.has(app.status) ? `/api/leases/${id}` : null
  );
  const { data: adverseAction, refetch: refetchNotice } = useApiQuery<AdverseActionNotice>(
    app && DENIED_STATUSES.has(app.status) ? `/api/applications/${id}/adverse-action` : null
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (loading) return <div className="flex justify-center p-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!app) return <p className="text-gray-500">Application not found</p>;

  async function doAction(action: string, fn: () => Promise<void>) {
    setActionLoading(action);
    setActionMessage(null);
    try {
      await fn();
      refetch();
      refetchLease();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Action failed' });
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={() => navigate('/applications')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Back to Applications
      </button>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {app.first_name} {app.last_name}
          </h1>
          <p className="text-sm text-gray-500">Unit: {app.unit_number || 'TBD'}</p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      {/* Action feedback */}
      {actionMessage && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMessage.text}
        </div>
      )}

      {/* Status Actions */}
      <div className="flex gap-2">
        {app.status === 'draft' && (
          <button
            onClick={() => doAction('submit', async () => { await api.post(`/api/applications/${id}/submit`); })}
            disabled={!!actionLoading}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> {actionLoading === 'submit' ? 'Submitting...' : 'Submit for Screening'}
          </button>
        )}
        {['draft', 'submitted'].includes(app.status) && (
          <button
            onClick={() => doAction('cancel', async () => { await api.patch(`/api/applications/${id}/cancel`, { reason: 'Cancelled by staff' }); })}
            disabled={!!actionLoading}
            className="flex items-center gap-1.5 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" /> Cancel
          </button>
        )}
      </div>

      {/* Applicant Info */}
      <Card title="Applicant Information">
        <Grid>
          <Detail label="Name" value={`${app.first_name} ${app.last_name}`} />
          <Detail label="Email" value={app.email} />
          <Detail label="Phone" value={app.phone} />
          <Detail label="SSN" value={app.ssn_masked || '***-**-****'} />
          <Detail label="Annual Income" value={app.annual_income != null ? `$${Number(app.annual_income).toLocaleString()}` : null} />
          <Detail label="Household Size" value={String(app.household_size)} />
        </Grid>
      </Card>

      {/* Screening Results */}
      {screening && (
        <Card title="Screening Results">
          <div className="flex gap-3 flex-wrap">
            <ResultChip label="Overall" status={screening.overallResult} />
            <ResultChip label="Background" status={screening.background.status} />
            <ResultChip label="Credit" status={screening.credit.status} />
            <ResultChip label="Compliance" status={screening.compliance.status} />
          </div>
        </Card>
      )}

      {/* Income Verification */}
      {POST_SCREENING_STATUSES.has(app.status) && (
        <Card title="Income Verification">
          {app.income_verified ? (
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-700">Income Verified</p>
                <p className="text-xs text-gray-500">
                  Verified {app.income_verified_at ? new Date(app.income_verified_at).toLocaleString() : ''}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <p className="text-sm text-amber-700">Income not yet verified (required for lease generation per LIHTC &sect;42)</p>
              </div>
              <div className="text-sm text-gray-600">
                <p>Reported annual income: <strong>${app.annual_income != null ? Number(app.annual_income).toLocaleString() : '—'}</strong></p>
                <p>Household size: <strong>{app.household_size}</strong></p>
              </div>
              <RoleGate minRole="senior_manager">
                <button
                  onClick={() => doAction('verify', async () => {
                    await api.patch(`/api/applications/${id}/verify-income`, {});
                    setActionMessage({ type: 'success', text: 'Income verified successfully' });
                  })}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle className="h-4 w-4" /> {actionLoading === 'verify' ? 'Verifying...' : 'Verify Income'}
                </button>
              </RoleGate>
            </div>
          )}
        </Card>
      )}

      {/* Approval Status */}
      {approvalStatus && (
        <Card title="Approval Workflow">
          <div className="space-y-3">
            <TierRow label="Tier 1 — Senior Manager" tier={approvalStatus.tier1} />
            <TierRow label="Tier 2 — Regional Manager" tier={approvalStatus.tier2} />
            <TierRow label="Tier 3 — Asset Manager" tier={approvalStatus.tier3} />
          </div>
        </Card>
      )}

      {/* Lease Generation & Onboarding */}
      {(app.status === 'tier3_approved' || app.status === 'lease_generated' || app.status === 'onboarded') && (
        <Card title="Lease & Onboarding">
          <div className="space-y-4">
            {/* Lease Generation */}
            {app.status === 'tier3_approved' && (
              <div className="space-y-3">
                {!app.income_verified ? (
                  <p className="text-sm text-amber-600">Income must be verified before generating a lease.</p>
                ) : (
                  <RoleGate minRole="senior_manager">
                    <button
                      onClick={() => doAction('lease', async () => {
                        const res = await api.post<{ leaseId: string; documentUrl: string }>(`/api/leases/${id}/generate`);
                        setActionMessage({ type: 'success', text: `Lease generated (ID: ${res.leaseId})` });
                      })}
                      disabled={!!actionLoading}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <FileText className="h-4 w-4" /> {actionLoading === 'lease' ? 'Generating...' : 'Generate Lease'}
                    </button>
                  </RoleGate>
                )}
              </div>
            )}

            {/* Lease Info */}
            {(app.status === 'lease_generated' || app.status === 'onboarded') && leaseStatus && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-blue-700">Lease Generated</p>
                    {leaseStatus.onesiteLeaseId && (
                      <p className="text-xs text-gray-500">OneSite Lease ID: {leaseStatus.onesiteLeaseId}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Onboarding */}
            {app.status === 'lease_generated' && (
              <RoleGate minRole="senior_manager">
                <button
                  onClick={() => doAction('onboard', async () => {
                    const res = await api.post<{ onboarded: boolean; loftTenantId: string }>(`/api/leases/${id}/onboard`);
                    setActionMessage({ type: 'success', text: `Tenant onboarded (Loft ID: ${res.loftTenantId})` });
                  })}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <Home className="h-4 w-4" /> {actionLoading === 'onboard' ? 'Onboarding...' : 'Complete Onboarding'}
                </button>
              </RoleGate>
            )}

            {/* Onboarded */}
            {app.status === 'onboarded' && leaseStatus && (
              <div className="flex items-center gap-2">
                <Home className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-green-700">Tenant Onboarded</p>
                  {leaseStatus.loftTenantId && (
                    <p className="text-xs text-gray-500">Loft Tenant ID: {leaseStatus.loftTenantId}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Adverse Action Notice */}
      {DENIED_STATUSES.has(app.status) && (
        <Card title="Adverse Action Notice (FCRA)">
          {adverseAction ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <p className="text-sm font-medium text-red-700">FCRA Notice Issued</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
                <p><span className="font-medium">Reason:</span> {adverseAction.reason.replace(/_/g, ' ')}</p>
                {adverseAction.reasonDetail && <p><span className="font-medium">Detail:</span> {adverseAction.reasonDetail}</p>}
                <p><span className="font-medium">Sent:</span> {new Date(adverseAction.sentAt).toLocaleString()}</p>
                <p><span className="font-medium">Via:</span> {adverseAction.sentVia.toUpperCase()}</p>
              </div>
              <RoleGate minRole="senior_manager">
                <button
                  onClick={() => doAction('resend', async () => {
                    await api.post(`/api/applications/${id}/adverse-action/resend`);
                    refetchNotice();
                    setActionMessage({ type: 'success', text: 'Adverse action notice resent' });
                  })}
                  disabled={!!actionLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {actionLoading === 'resend' ? 'Sending...' : 'Resend Notice'}
                </button>
              </RoleGate>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <p className="text-sm text-amber-700">No adverse action notice on file — this may indicate a compliance gap.</p>
            </div>
          )}
        </Card>
      )}

      <Card title="Timeline">
        <div className="text-sm text-gray-500 space-y-1">
          <p>Created: {new Date(app.created_at).toLocaleString()}</p>
          {app.submitted_at && <p>Submitted: {new Date(app.submitted_at).toLocaleString()}</p>}
        </div>
      </Card>

      {/* Two-way messaging thread with applicant/tenant */}
      {id && <ApplicationMessages applicationId={id} />}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="text-sm font-medium text-gray-600 uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">{children}</div>;
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-900">{value || '—'}</p>
    </div>
  );
}

function ResultChip({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
      <span className="text-xs text-gray-500">{label}</span>
      <StatusBadge status={status} />
    </div>
  );
}

function TierRow({ label, tier }: { label: string; tier: { required: boolean; completed: boolean; decision: string | null; decidedAt: string | null; notes: string | null } }) {
  if (!tier.required) return <p className="text-sm text-gray-400">{label}: Not required</p>;
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        {tier.completed ? (
          <>
            <StatusBadge status={tier.decision || ''} />
            {tier.decidedAt && <span className="text-xs text-gray-400">{new Date(tier.decidedAt).toLocaleDateString()}</span>}
          </>
        ) : (
          <span className="text-xs text-amber-600">Pending</span>
        )}
      </div>
    </div>
  );
}
