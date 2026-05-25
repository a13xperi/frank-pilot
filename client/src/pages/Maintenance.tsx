import { useState } from 'react';
import { Wrench, Plus, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { ResponsiveCards } from '@/components/ResponsiveCards';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { WorkOrder, PropertyListResponse, UserListResponse } from '@/types';

const CATEGORIES = [
  'plumbing_leak', 'frozen_pipes', 'no_heat', 'electrical_failure',
  'gas_leak', 'flooding', 'appliance_repair', 'hvac', 'pest_control',
  'lock_change', 'painting', 'carpet', 'general_repair', 'other',
];

export function MaintenancePage() {
  const { data, loading, error, refetch } = useApiQuery<{ workOrders: WorkOrder[]; total: number }>('/api/maintenance?limit=100');
  const { data: propsData } = useApiQuery<PropertyListResponse>('/api/properties');
  const { data: usersData } = useApiQuery<UserListResponse>('/api/users');
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create form
  const [createPropId, setCreatePropId] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createPriority, setCreatePriority] = useState('routine');
  const [createCategory, setCreateCategory] = useState('');
  const [createUnit, setCreateUnit] = useState('');

  // Assign/Complete
  const [assignTo, setAssignTo] = useState('');
  const [completeNotes, setCompleteNotes] = useState('');
  const [completeCost, setCompleteCost] = useState('');

  const workOrders = data?.workOrders || [];
  const emergencies = workOrders.filter((w) => w.is_emergency && w.status !== 'completed' && w.status !== 'cancelled').length;
  const open = workOrders.filter((w) => !['completed', 'cancelled'].includes(w.status)).length;
  const completed = workOrders.filter((w) => w.status === 'completed').length;

  const columns: Column<WorkOrder>[] = [
    {
      key: 'priority',
      header: '',
      render: (r) => r.is_emergency ? <AlertTriangle className="h-4 w-4 text-red-600" /> : null,
    },
    { key: 'title', header: 'Title' },
    { key: 'property_name', header: 'Property' },
    { key: 'unit_number', header: 'Unit' },
    {
      key: 'priorityBadge',
      header: 'Priority',
      render: (r) => <StatusBadge status={r.priority} />,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'assigned_to_name', header: 'Assigned To' },
    { key: 'created_at', header: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Wrench}
        title="Maintenance"
        description="Work orders, emergency requests, and repair tracking"
        action={
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Work Order
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Emergencies" value={emergencies} icon={AlertTriangle} color={emergencies > 0 ? 'red' : 'gray'} />
        <StatCard label="Open Orders" value={open} icon={Clock} color="blue" />
        <StatCard label="Completed" value={completed} icon={CheckCircle} color="green" />
      </div>

      {actionMsg && <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{actionMsg.text}</div>}

      {/* Table at md+, stacked cards below md (same columns + data + handler). */}
      <div className="hidden md:block">
        <DataTable columns={columns} data={workOrders} loading={loading} error={error} onRowClick={setSelected} emptyMessage="No work orders" />
      </div>
      <ResponsiveCards className="md:hidden" columns={columns} data={workOrders} loading={loading} error={error} onRowClick={setSelected} emptyMessage="No work orders" />

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Work Order" wide>
        <div className="space-y-3">
          <div>
            <label className="label">Property</label>
            <select value={createPropId} onChange={(e) => setCreatePropId(e.target.value)} className="input">
              <option value="">Select property...</option>
              {(propsData?.properties || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="label">Title</label><input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} className="input" placeholder="Brief description" /></div>
          <div><label className="label">Description</label><textarea value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} rows={3} className="input" placeholder="Full details of the issue" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Priority</label>
              <select value={createPriority} onChange={(e) => setCreatePriority(e.target.value)} className="input">
                <option value="low">Low</option>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select value={createCategory} onChange={(e) => setCreateCategory(e.target.value)} className="input">
                <option value="">Select...</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div><label className="label">Unit</label><input value={createUnit} onChange={(e) => setCreateUnit(e.target.value)} className="input" placeholder="A-102" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" disabled={!createPropId || !createTitle || !createDesc} onClick={async () => {
              try {
                await api.post('/api/maintenance', {
                  propertyId: createPropId, title: createTitle, description: createDesc,
                  priority: createPriority, category: createCategory || undefined, unitNumber: createUnit || undefined,
                });
                setActionMsg({ type: 'success', text: 'Work order created' });
                setShowCreate(false); setCreatePropId(''); setCreateTitle(''); setCreateDesc(''); setCreateUnit('');
                refetch();
              } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
            }}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setAssignTo(''); setCompleteNotes(''); setCompleteCost(''); }} title={`Work Order: ${selected?.title || ''}`} wide>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Property" value={selected.property_name} />
              <Detail label="Unit" value={selected.unit_number} />
              <Detail label="Priority" value={selected.priority} />
              <Detail label="Status" value={selected.status} />
              <Detail label="Category" value={selected.category?.replace(/_/g, ' ')} />
              <Detail label="Emergency" value={selected.is_emergency ? 'YES' : 'No'} />
              <Detail label="Submitted By" value={selected.submitted_by_name} />
              <Detail label="Assigned To" value={selected.assigned_to_name} />
              <Detail label="Created" value={new Date(selected.created_at).toLocaleDateString()} />
              <Detail label="Completed" value={selected.completed_at ? new Date(selected.completed_at).toLocaleDateString() : '—'} />
            </div>
            <div className="text-sm"><p className="text-xs text-gray-400">Description</p><p>{selected.description}</p></div>
            {selected.completion_notes && <div className="text-sm"><p className="text-xs text-gray-400">Completion Notes</p><p>{selected.completion_notes}</p></div>}

            <RoleGate minRole="senior_manager">
              <div className="space-y-3 border-t border-gray-200 pt-3">
                {/* Assign */}
                {['submitted', 'assigned'].includes(selected.status) && (
                  <div className="flex gap-2">
                    <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="input flex-1">
                      <option value="">Assign to...</option>
                      {(usersData?.users || []).map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role.replace(/_/g, ' ')})</option>)}
                    </select>
                    <button disabled={!assignTo} onClick={async () => {
                      try {
                        await api.post(`/api/maintenance/${selected.id}/assign`, { assignedTo: assignTo });
                        setActionMsg({ type: 'success', text: 'Work order assigned' });
                        setSelected(null); setAssignTo(''); refetch();
                      } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                    }} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Assign</button>
                  </div>
                )}

                {/* Start */}
                {selected.status === 'assigned' && (
                  <button onClick={async () => {
                    try {
                      await api.post(`/api/maintenance/${selected.id}/start`);
                      setActionMsg({ type: 'success', text: 'Work started' });
                      setSelected(null); refetch();
                    } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                  }} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700">Start Work</button>
                )}

                {/* Complete */}
                {['assigned', 'in_progress'].includes(selected.status) && (
                  <div className="space-y-2">
                    <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} rows={2} className="input" placeholder="Completion notes (required)" />
                    <div className="flex gap-2">
                      <input type="number" step="0.01" min="0" value={completeCost} onChange={(e) => setCompleteCost(e.target.value)} className="input w-40" placeholder="Actual cost" />
                      <Button variant="primary" disabled={!completeNotes.trim()} onClick={async () => {
                        try {
                          await api.post(`/api/maintenance/${selected.id}/complete`, {
                            notes: completeNotes, actualCost: completeCost ? parseFloat(completeCost) : undefined,
                          });
                          setActionMsg({ type: 'success', text: 'Work order completed' });
                          setSelected(null); setCompleteNotes(''); setCompleteCost(''); refetch();
                        } catch (err: any) { setActionMsg({ type: 'error', text: err?.message || 'Failed' }); }
                      }}>Complete</Button>
                    </div>
                  </div>
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
  const colors: Record<string, string> = { red: 'bg-red-50 text-red-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', gray: 'bg-gray-50 text-gray-700' };
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
