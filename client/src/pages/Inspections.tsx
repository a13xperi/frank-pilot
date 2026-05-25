import { useState } from 'react';
import { ClipboardCheck, Plus, Calendar, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { Inspection, PropertyListResponse } from '@/types';

export function InspectionsPage() {
  const { data, loading, refetch } = useApiQuery<{ inspections: Inspection[]; total: number }>('/api/inspections?limit=100');
  const { data: propsData } = useApiQuery<PropertyListResponse>('/api/properties');
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Schedule form
  const [schedPropId, setSchedPropId] = useState('');
  const [schedType, setSchedType] = useState('monthly');
  const [schedDate, setSchedDate] = useState('');
  const [schedUnit, setSchedUnit] = useState('');

  // Complete form
  const [completeNotes, setCompleteNotes] = useState('');
  const [smokeOk, setSmokeOk] = useState(true);
  const [hqsOk, setHqsOk] = useState(true);
  const [followUp, setFollowUp] = useState(false);

  const inspections = data?.inspections || [];
  const scheduled = inspections.filter((i) => ['scheduled', 'notice_sent'].includes(i.status)).length;
  const overdue = inspections.filter((i) => i.status !== 'completed' && i.status !== 'cancelled' && new Date(i.scheduled_date) < new Date()).length;
  const completedCount = inspections.filter((i) => i.status === 'completed').length;

  const columns: Column<Inspection>[] = [
    { key: 'property_name', header: 'Property' },
    { key: 'unit_number', header: 'Unit' },
    { key: 'inspection_type', header: 'Type', render: (r) => <StatusBadge status={r.inspection_type} /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'scheduled_date', header: 'Scheduled', render: (r) => new Date(r.scheduled_date).toLocaleDateString() },
    { key: 'inspector_name', header: 'Inspector' },
    { key: 'smoke', header: 'Smoke Det.', render: (r) => r.smoke_detector_ok === null ? '—' : r.smoke_detector_ok ? 'OK' : 'FAIL' },
    { key: 'followup', header: '', render: (r) => r.follow_up_required ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : null },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ClipboardCheck}
        title="Inspections"
        description="Unit inspections, smoke detector compliance, and HQS/UPCS records"
        action={
          <RoleGate minRole="senior_manager">
            <Button variant="primary" onClick={() => setShowSchedule(true)}>
              <Plus className="h-4 w-4" /> Schedule Inspection
            </Button>
          </RoleGate>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Scheduled" value={scheduled} icon={Calendar} color="blue" />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} color={overdue > 0 ? 'red' : 'gray'} />
        <StatCard label="Completed" value={completedCount} icon={ClipboardCheck} color="green" />
      </div>

      {actionMsg && <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{actionMsg.text}</div>}

      <DataTable columns={columns} data={inspections} loading={loading} onRowClick={setSelected} emptyMessage="No inspections scheduled" />

      {/* Schedule Modal */}
      <Modal open={showSchedule} onClose={() => setShowSchedule(false)} title="Schedule Inspection" wide>
        <div className="space-y-3">
          <div>
            <label className="label">Property</label>
            <select value={schedPropId} onChange={(e) => setSchedPropId(e.target.value)} className="input">
              <option value="">Select property...</option>
              {(propsData?.properties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select value={schedType} onChange={(e) => setSchedType(e.target.value)} className="input">
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="smoke_detector">Smoke Detector</option>
                <option value="hqs">HQS/UPCS</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className="input" />
            </div>
          </div>
          <div><label className="label">Unit (optional)</label><input value={schedUnit} onChange={(e) => setSchedUnit(e.target.value)} className="input" placeholder="e.g. A-102" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowSchedule(false)}>Cancel</Button>
            <Button variant="primary" disabled={!schedPropId || !schedDate} onClick={async () => {
              try {
                await api.post('/api/inspections', { propertyId: schedPropId, inspectionType: schedType, scheduledDate: schedDate, unitNumber: schedUnit || undefined });
                setActionMsg({ type: 'success', text: 'Inspection scheduled' });
                setShowSchedule(false); setSchedPropId(''); setSchedDate(''); setSchedUnit('');
                refetch();
              } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
            }}>Schedule</Button>
          </div>
        </div>
      </Modal>

      {/* Detail + Complete Modal */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setCompleteNotes(''); }} title={`Inspection: ${selected?.property_name || ''} ${selected?.unit_number || ''}`} wide>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Type" value={selected.inspection_type} />
              <Detail label="Status" value={selected.status} />
              <Detail label="Scheduled" value={new Date(selected.scheduled_date).toLocaleDateString()} />
              <Detail label="Completed" value={selected.completed_date ? new Date(selected.completed_date).toLocaleDateString() : '—'} />
              <Detail label="Inspector" value={selected.inspector_name} />
              <Detail label="Smoke Detector" value={selected.smoke_detector_ok === null ? 'Not checked' : selected.smoke_detector_ok ? 'OK' : 'FAIL'} />
              <Detail label="HQS Compliant" value={selected.hqs_compliant === null ? 'Not checked' : selected.hqs_compliant ? 'Yes' : 'No'} />
              <Detail label="Follow-Up Required" value={selected.follow_up_required ? 'Yes' : 'No'} />
            </div>
            {selected.notes && <div className="text-sm"><p className="text-xs text-gray-400">Notes</p><p>{selected.notes}</p></div>}

            {['scheduled', 'notice_sent', 'in_progress'].includes(selected.status) && (
              <RoleGate minRole="senior_manager">
                <div className="space-y-3 border-t border-gray-200 pt-3">
                  <p className="text-sm font-medium">Complete Inspection</p>
                  <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} rows={3} className="input" placeholder="Room-by-room notes..." />
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={smokeOk} onChange={(e) => setSmokeOk(e.target.checked)} /> Smoke Detector OK</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hqsOk} onChange={(e) => setHqsOk(e.target.checked)} /> HQS Compliant</label>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} /> Follow-Up Required</label>
                  </div>
                  <Button variant="primary" disabled={!completeNotes.trim()} onClick={async () => {
                    try {
                      await api.post(`/api/inspections/${selected.id}/complete`, { notes: completeNotes, smokeDetectorOk: smokeOk, hqsCompliant: hqsOk, followUpRequired: followUp });
                      setActionMsg({ type: 'success', text: 'Inspection completed' });
                      setSelected(null); setCompleteNotes(''); refetch();
                    } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                  }}>Complete Inspection</Button>
                </div>
              </RoleGate>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-700', red: 'bg-red-50 text-red-700', green: 'bg-green-50 text-green-700', gray: 'bg-gray-50 text-gray-700' };
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
