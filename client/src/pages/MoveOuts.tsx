import { useState } from 'react';
import { LogOut, ClipboardCheck, DollarSign, Clock, Plus } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { MoveOut } from '@/types';

const DEDUCTION_CATEGORIES = ['keys', 'cleaning', 'repairs', 'painting', 'debris', 'carpet', 'appliance_damage', 'other'];

export function MoveOuts() {
  const { data, loading, refetch } = useApiQuery<{ moveOuts: MoveOut[] }>('/api/moveouts');
  const [selected, setSelected] = useState<MoveOut | null>(null);
  const [showInitiate, setShowInitiate] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Initiate form
  const [initAppId, setInitAppId] = useState('');
  const [initDate, setInitDate] = useState(new Date().toISOString().split('T')[0]);
  const [initAddr, setInitAddr] = useState('');

  // Deposit form
  const [deductions, setDeductions] = useState<Record<string, string>>({});

  // Inspection form
  const [inspType, setInspType] = useState<'pre' | 'final'>('pre');
  const [inspNotes, setInspNotes] = useState('');

  const moveOuts = data?.moveOuts || [];
  const active = moveOuts.filter((m) => !['closed', 'collections'].includes(m.status)).length;
  const inspDue = moveOuts.filter((m) => ['notice_received', 'pre_inspection_scheduled'].includes(m.status)).length;
  const deadlineSoon = moveOuts.filter((m) => {
    if (!m.deposit_deadline || ['deposit_sent', 'closed'].includes(m.status)) return false;
    return Math.ceil((new Date(m.deposit_deadline).getTime() - Date.now()) / 86400000) <= 7;
  }).length;

  const columns: Column<MoveOut>[] = [
    { key: 'tenant_name', header: 'Tenant' },
    { key: 'property_name', header: 'Property' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'notice_date', header: 'Notice', render: (r) => new Date(r.notice_date).toLocaleDateString() },
    { key: 'expected_vacate_date', header: 'Vacate By', render: (r) => new Date(r.expected_vacate_date).toLocaleDateString() },
    {
      key: 'deposit_deadline',
      header: 'Deposit Deadline',
      render: (r) => {
        if (!r.deposit_deadline) return '—';
        const days = Math.ceil((new Date(r.deposit_deadline).getTime() - Date.now()) / 86400000);
        const color = days <= 0 ? 'text-red-700 font-bold' : days <= 7 ? 'text-amber-600' : 'text-gray-600';
        return <span className={color}>{new Date(r.deposit_deadline).toLocaleDateString()} ({days}d)</span>;
      },
    },
    {
      key: 'refund_amount',
      header: 'Refund',
      className: 'text-right',
      render: (r) => r.refund_amount != null ? `$${r.refund_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—',
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={LogOut}
        title="Move-Outs"
        description="Tenant vacate notices, inspections, and deposit disposition"
        action={
          <RoleGate minRole="senior_manager">
            <Button variant="danger" onClick={() => setShowInitiate(true)}>
              <Plus className="h-4 w-4" /> Initiate Move-Out
            </Button>
          </RoleGate>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active Move-Outs" value={active} icon={LogOut} color="blue" />
        <StatCard label="Inspections Due" value={inspDue} icon={ClipboardCheck} color="amber" />
        <StatCard label="Deposit Deadline < 7d" value={deadlineSoon} icon={Clock} color={deadlineSoon > 0 ? 'red' : 'gray'} />
      </div>

      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      <DataTable columns={columns} data={moveOuts} loading={loading} onRowClick={setSelected} emptyMessage="No move-outs" />

      {/* Initiate Modal */}
      <Modal open={showInitiate} onClose={() => setShowInitiate(false)} title="Initiate Move-Out" wide>
        <div className="space-y-3">
          <div><label className="label">Application ID</label><input value={initAppId} onChange={(e) => setInitAppId(e.target.value)} className="input" placeholder="Tenant application UUID" /></div>
          <div><label className="label">Notice Date</label><input type="date" value={initDate} onChange={(e) => setInitDate(e.target.value)} className="input" /></div>
          <div><label className="label">Forwarding Address (required)</label><input value={initAddr} onChange={(e) => setInitAddr(e.target.value)} className="input" placeholder="New address for deposit refund" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowInitiate(false)}>Cancel</Button>
            <Button variant="danger" disabled={!initAppId || !initAddr} onClick={async () => {
              try {
                await api.post('/api/moveouts', { applicationId: initAppId, noticeDate: initDate, forwardingAddress: initAddr });
                setActionMsg({ type: 'success', text: 'Move-out initiated' });
                setShowInitiate(false); setInitAppId(''); setInitAddr('');
                refetch();
              } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
            }}>Initiate</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setInspNotes(''); setDeductions({}); }} title={`Move-Out: ${selected?.tenant_name || ''}`} wide>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Property" value={selected.property_name} />
              <Detail label="Status" value={selected.status.replace(/_/g, ' ')} />
              <Detail label="Notice Date" value={new Date(selected.notice_date).toLocaleDateString()} />
              <Detail label="Expected Vacate" value={new Date(selected.expected_vacate_date).toLocaleDateString()} />
              <Detail label="Forwarding Address" value={selected.forwarding_address} />
              <Detail label="Deposit" value={selected.deposit_amount != null ? `$${selected.deposit_amount.toLocaleString()}` : '—'} />
              <Detail label="Deposit Deadline" value={selected.deposit_deadline ? new Date(selected.deposit_deadline).toLocaleDateString() : '—'} />
              <Detail label="Unpaid Rent" value={selected.unpaid_rent_balance != null ? `$${selected.unpaid_rent_balance.toLocaleString()}` : '—'} />
            </div>

            {/* Inspections */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase">Inspections</p>
              <div className="flex gap-3">
                <InspectionBadge label="Pre-Inspection" date={selected.pre_inspection_date} notes={selected.pre_inspection_notes} />
                <InspectionBadge label="Final Inspection" date={selected.final_inspection_date} notes={selected.final_inspection_notes} />
              </div>
            </div>

            {/* Deductions */}
            {selected.deductions_detail && Object.keys(selected.deductions_detail).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase">Deductions</p>
                {Object.entries(selected.deductions_detail).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-gray-600 capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-red-600">${(v as number).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-medium border-t pt-1">
                  <span>Total Deductions</span><span className="text-red-600">${selected.deductions_total?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span>Refund Amount</span><span className="text-green-600">${selected.refund_amount?.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <RoleGate minRole="senior_manager">
              <div className="space-y-3 border-t border-gray-200 pt-3">
                {/* Record Inspection */}
                {['notice_received', 'pre_inspection_scheduled', 'pre_inspection_complete', 'vacated'].includes(selected.status) && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select value={inspType} onChange={(e) => setInspType(e.target.value as 'pre' | 'final')} className="input w-40">
                        <option value="pre">Pre-Inspection</option>
                        <option value="final">Final Inspection</option>
                      </select>
                      <input value={inspNotes} onChange={(e) => setInspNotes(e.target.value)} className="input flex-1" placeholder="Inspection notes" />
                      <button disabled={!inspNotes.trim()} onClick={async () => {
                        try {
                          await api.post(`/api/moveouts/${selected.id}/inspection`, { inspectionType: inspType, notes: inspNotes });
                          setActionMsg({ type: 'success', text: `${inspType} inspection recorded` });
                          setSelected(null); setInspNotes(''); refetch();
                        } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                      }} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                        <ClipboardCheck className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Calculate Deposit */}
                {['final_inspection_complete', 'vacated'].includes(selected.status) && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700">Deposit Disposition</p>
                    <div className="grid grid-cols-2 gap-2">
                      {DEDUCTION_CATEGORIES.map((cat) => (
                        <div key={cat} className="flex items-center gap-2">
                          <label className="text-xs text-gray-500 capitalize w-28">{cat.replace(/_/g, ' ')}</label>
                          <input type="number" step="0.01" min="0" value={deductions[cat] || ''} onChange={(e) => setDeductions({ ...deductions, [cat]: e.target.value })}
                            className="input w-24" placeholder="0.00" />
                        </div>
                      ))}
                    </div>
                    <button onClick={async () => {
                      const parsed: Record<string, number> = {};
                      for (const [k, v] of Object.entries(deductions)) { if (v && parseFloat(v) > 0) parsed[k] = parseFloat(v); }
                      try {
                        const res = await api.post<{ refundAmount: number }>(`/api/moveouts/${selected.id}/deposit`, { deductions: parsed });
                        setActionMsg({ type: 'success', text: `Deposit calculated. Refund: $${res.refundAmount.toFixed(2)}` });
                        setSelected(null); setDeductions({}); refetch();
                      } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                    }} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">
                      <DollarSign className="h-4 w-4 inline mr-1" /> Calculate Deposit
                    </button>
                  </div>
                )}

                {/* Send Refund */}
                {selected.status === 'deposit_calculated' && (
                  <Button variant="primary" onClick={async () => {
                    try {
                      await api.post(`/api/moveouts/${selected.id}/refund`);
                      setActionMsg({ type: 'success', text: 'Deposit refund sent' });
                      setSelected(null); refetch();
                    } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                  }}>Send Deposit Refund</Button>
                )}
              </div>
            </RoleGate>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', gray: 'bg-gray-50 text-gray-700' };
  return (
    <div className={`rounded-xl border border-gray-200 p-4 ${colors[color] || colors.gray}`}>
      <div className="flex items-center gap-2"><Icon className="h-5 w-5" /><span className="text-2xl font-bold">{value}</span></div>
      <p className="mt-1 text-xs font-medium opacity-75">{label}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><p className="text-xs text-gray-400">{label}</p><p className="text-sm text-gray-900">{value || '—'}</p></div>;
}

function InspectionBadge({ label, date, notes }: { label: string; date: string | null; notes: string | null }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${date ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
      <p className={`font-medium ${date ? 'text-green-700' : 'text-gray-500'}`}>{label}</p>
      {date ? (
        <><p className="text-xs text-green-600">{new Date(date).toLocaleDateString()}</p>{notes && <p className="text-xs text-gray-500 mt-1">{notes}</p>}</>
      ) : (
        <p className="text-xs text-gray-400">Not completed</p>
      )}
    </div>
  );
}
