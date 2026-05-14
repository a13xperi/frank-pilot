import { useState } from 'react';
import { Gavel, AlertTriangle, FileText, Scale, Plus } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { Violation, EvictionNotice, EvictionCase } from '@/types';

type Tab = 'Violations' | 'Notices' | 'Cases';

const VIOLATION_TYPES = [
  'nonpayment', 'late_payment_pattern', 'lease_violation', 'noise_disturbance',
  'property_damage', 'unauthorized_occupant', 'drug_violation', 'criminal_activity',
  'unauthorized_pet', 'health_safety', 'other',
];

const NOTICE_TYPES = [
  { value: 'pay_or_quit_7day', label: '7-Day Pay or Quit (NRS 40.253)' },
  { value: 'perform_or_quit_5day', label: '5-Day Perform or Quit' },
  { value: 'nuisance_quit_3day', label: '3-Day Quit (Nuisance/Drug)' },
  { value: 'no_cause_30day', label: '30-Day No Cause' },
  { value: 'nonpayment_cares_30day', label: '30-Day CARES Act' },
  { value: 'cure_or_quit_5day', label: '5-Day Cure or Quit' },
];

export function Evictions() {
  const [tab, setTab] = useState<Tab>('Violations');
  const [showReport, setShowReport] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<Violation | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<EvictionNotice | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [reportAppId, setReportAppId] = useState('');
  const [reportType, setReportType] = useState('nonpayment');
  const [reportDesc, setReportDesc] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [noticeType, setNoticeType] = useState('pay_or_quit_7day');
  const [resolveNotes, setResolveNotes] = useState('');

  const { data: violationsData, loading: vLoading, refetch: refetchV } = useApiQuery<{ violations: Violation[]; total: number }>('/api/evictions/violations?limit=100');
  const { data: noticesData, loading: nLoading, refetch: refetchN } = useApiQuery<{ notices: EvictionNotice[] }>('/api/evictions/notices');
  const { data: casesData, loading: cLoading, refetch: refetchC } = useApiQuery<{ cases: EvictionCase[] }>('/api/evictions/cases');

  const refetchAll = () => { refetchV(); refetchN(); refetchC(); };

  const violationCols: Column<Violation>[] = [
    { key: 'tenant_name', header: 'Tenant' },
    { key: 'property_name', header: 'Property' },
    { key: 'violation_type', header: 'Type', render: (r) => <StatusBadge status={r.violation_type} /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'occurred_at', header: 'Date', render: (r) => new Date(r.occurred_at).toLocaleDateString() },
    { key: 'flags', header: 'Flags', render: (r) => (
      <div className="flex gap-1">
        {r.is_material_breach && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">Breach</span>}
        {r.vawa_flagged && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">VAWA</span>}
      </div>
    )},
  ];

  const noticeCols: Column<EvictionNotice>[] = [
    { key: 'tenant_name', header: 'Tenant' },
    { key: 'notice_type', header: 'Type', render: (r) => r.notice_type.replace(/_/g, ' ') },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'amount_owed', header: 'Amount', className: 'text-right', render: (r) => r.amount_owed ? `$${r.amount_owed.toLocaleString()}` : '—' },
    { key: 'serve_date', header: 'Served', render: (r) => r.serve_date ? new Date(r.serve_date).toLocaleDateString() : '—' },
    { key: 'expiration_date', header: 'Expires', render: (r) => r.expiration_date ? new Date(r.expiration_date).toLocaleDateString() : '—' },
    { key: 'cares', header: '', render: (r) => r.cares_act_applicable ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">CARES</span> : null },
  ];

  const caseCols: Column<EvictionCase>[] = [
    { key: 'tenant_name', header: 'Tenant' },
    { key: 'property_name', header: 'Property' },
    { key: 'case_number', header: 'Case #' },
    { key: 'jurisdiction', header: 'Jurisdiction' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'filing_date', header: 'Filed', render: (r) => r.filing_date ? new Date(r.filing_date).toLocaleDateString() : '—' },
    { key: 'hearing_date', header: 'Hearing', render: (r) => r.hearing_date ? new Date(r.hearing_date).toLocaleDateString() : '—' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Gavel}
        title="Evictions & Violations"
        description="Lease violations, NV eviction notices, and court case tracking"
        action={
          <RoleGate minRole="senior_manager">
            <button onClick={() => setShowReport(true)} className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
              <Plus className="h-4 w-4" /> Report Violation
            </button>
          </RoleGate>
        }
      />

      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['Violations', 'Notices', 'Cases'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'Violations' && <AlertTriangle className="h-4 w-4" />}
            {t === 'Notices' && <FileText className="h-4 w-4" />}
            {t === 'Cases' && <Scale className="h-4 w-4" />}
            {t}
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
              {t === 'Violations' ? violationsData?.total || 0 : t === 'Notices' ? noticesData?.notices?.length || 0 : casesData?.cases?.length || 0}
            </span>
          </button>
        ))}
      </div>

      {tab === 'Violations' && (
        <DataTable columns={violationCols} data={violationsData?.violations || []} loading={vLoading} onRowClick={(v) => setSelectedViolation(v)} emptyMessage="No violations reported" />
      )}
      {tab === 'Notices' && (
        <DataTable columns={noticeCols} data={noticesData?.notices || []} loading={nLoading} onRowClick={(n) => setSelectedNotice(n)} emptyMessage="No notices generated" />
      )}
      {tab === 'Cases' && (
        <DataTable columns={caseCols} data={casesData?.cases || []} loading={cLoading} emptyMessage="No eviction cases filed" />
      )}

      {/* Report Violation Modal */}
      <Modal open={showReport} onClose={() => setShowReport(false)} title="Report Violation" wide>
        <div className="space-y-3">
          <div>
            <label className="label">Application ID</label>
            <input value={reportAppId} onChange={(e) => setReportAppId(e.target.value)} className="input" placeholder="Tenant application UUID" />
          </div>
          <div>
            <label className="label">Violation Type</label>
            <select value={reportType} onChange={(e) => setReportType(e.target.value)} className="input">
              {VIOLATION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea value={reportDesc} onChange={(e) => setReportDesc(e.target.value)} rows={3} className="input" placeholder="What happened" />
          </div>
          <div>
            <label className="label">Date Occurred</label>
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="input" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowReport(false)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              disabled={!reportAppId || !reportDesc}
              onClick={async () => {
                try {
                  await api.post('/api/evictions/violations', { applicationId: reportAppId, violationType: reportType, description: reportDesc, occurredAt: reportDate });
                  setActionMsg({ type: 'success', text: 'Violation reported' });
                  setShowReport(false);
                  setReportAppId(''); setReportDesc('');
                  refetchAll();
                } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Report
            </button>
          </div>
        </div>
      </Modal>

      {/* Violation Detail Modal */}
      <Modal open={!!selectedViolation} onClose={() => { setSelectedViolation(null); setResolveNotes(''); }} title={`Violation: ${selectedViolation?.tenant_name || ''}`} wide>
        {selectedViolation && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Type" value={selectedViolation.violation_type.replace(/_/g, ' ')} />
              <Detail label="Status" value={selectedViolation.status.replace(/_/g, ' ')} />
              <Detail label="Date" value={new Date(selectedViolation.occurred_at).toLocaleDateString()} />
              <Detail label="Property" value={selectedViolation.property_name} />
              <Detail label="Material Breach" value={selectedViolation.is_material_breach ? 'YES' : 'No'} />
              <Detail label="VAWA Protected" value={selectedViolation.vawa_flagged ? 'YES — Eviction blocked' : 'No'} />
            </div>
            <div className="text-sm"><p className="text-xs text-gray-400">Description</p><p>{selectedViolation.description}</p></div>

            {selectedViolation.cure_deadline && (
              <div className="text-sm"><p className="text-xs text-gray-400">Cure Deadline</p><p>{new Date(selectedViolation.cure_deadline).toLocaleDateString()}</p></div>
            )}

            <RoleGate minRole="senior_manager">
              <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-3">
                {selectedViolation.status === 'reported' && (
                  <button onClick={async () => {
                    try { await api.post(`/api/evictions/violations/${selectedViolation.id}/warning`); setActionMsg({ type: 'success', text: 'Warning issued' }); setSelectedViolation(null); refetchAll(); }
                    catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                  }} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">Issue Warning</button>
                )}
                {['reported', 'warning_issued'].includes(selectedViolation.status) && !selectedViolation.vawa_flagged && (
                  <button onClick={() => setShowNotice(true)} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Generate Notice</button>
                )}
                {!['resolved', 'dismissed'].includes(selectedViolation.status) && (
                  <>
                    <div className="w-full mt-2">
                      <textarea value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} rows={2} className="input" placeholder="Resolution / dismissal notes (required)" />
                    </div>
                    <button disabled={!resolveNotes.trim()} onClick={async () => {
                      try { await api.post(`/api/evictions/violations/${selectedViolation.id}/resolve`, { notes: resolveNotes }); setActionMsg({ type: 'success', text: 'Violation resolved' }); setSelectedViolation(null); setResolveNotes(''); refetchAll(); }
                      catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                    }} className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">Resolve</button>
                    <button disabled={!resolveNotes.trim()} onClick={async () => {
                      try { await api.post(`/api/evictions/violations/${selectedViolation.id}/dismiss`, { notes: resolveNotes }); setActionMsg({ type: 'success', text: 'Violation dismissed' }); setSelectedViolation(null); setResolveNotes(''); refetchAll(); }
                      catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                    }} className="rounded-lg bg-gray-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50">Dismiss</button>
                  </>
                )}
              </div>
            </RoleGate>
          </div>
        )}
      </Modal>

      {/* Generate Notice Modal */}
      <Modal open={showNotice} onClose={() => setShowNotice(false)} title="Generate Eviction Notice">
        <div className="space-y-3">
          <div>
            <label className="label">Notice Type</label>
            <select value={noticeType} onChange={(e) => setNoticeType(e.target.value)} className="input">
              {NOTICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowNotice(false)} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button onClick={async () => {
              if (!selectedViolation) return;
              try {
                await api.post<{ noticeId: string; noticeText: string }>(`/api/evictions/violations/${selectedViolation.id}/notice`, { noticeType });
                setActionMsg({ type: 'success', text: 'Notice generated' });
                setShowNotice(false);
                setSelectedViolation(null);
                refetchAll();
              } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
            }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Generate</button>
          </div>
        </div>
      </Modal>

      {/* Notice Detail Modal */}
      <Modal open={!!selectedNotice} onClose={() => setSelectedNotice(null)} title={`Notice: ${selectedNotice?.tenant_name || ''}`} wide>
        {selectedNotice && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Type" value={selectedNotice.notice_type.replace(/_/g, ' ')} />
              <Detail label="Status" value={selectedNotice.status} />
              <Detail label="Served" value={selectedNotice.serve_date ? new Date(selectedNotice.serve_date).toLocaleDateString() : 'Not served'} />
              <Detail label="Expires" value={selectedNotice.expiration_date ? new Date(selectedNotice.expiration_date).toLocaleDateString() : '—'} />
              {selectedNotice.amount_owed && <Detail label="Amount Owed" value={`$${selectedNotice.amount_owed.toLocaleString()}`} />}
              <Detail label="Certificate of Mailing" value={selectedNotice.certificate_of_mailing ? 'Yes' : 'No'} />
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">{selectedNotice.notice_text}</pre>
            </div>
            {selectedNotice.status === 'draft' && (
              <RoleGate minRole="senior_manager">
                <button onClick={async () => {
                  try { await api.post(`/api/evictions/notices/${selectedNotice.id}/serve`); setActionMsg({ type: 'success', text: 'Notice served' }); setSelectedNotice(null); refetchAll(); }
                  catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Mark as Served</button>
              </RoleGate>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-900">{value || '—'}</p>
    </div>
  );
}
