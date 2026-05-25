import { useState } from 'react';
import { RefreshCw, Check, X, ArrowRightLeft } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import type { LeaseRenewal } from '@/types';

export function Renewals() {
  const { data, loading, refetch } = useApiQuery<{ renewals: LeaseRenewal[] }>('/api/renewals');
  const [selected, setSelected] = useState<LeaseRenewal | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const renewals = data?.renewals || [];
  const pending = renewals.filter((r) => r.status === 'offered').length;
  const accepted = renewals.filter((r) => r.status === 'accepted').length;
  const expiringSoon = renewals.filter((r) => {
    if (r.status !== 'offered' || !r.response_deadline) return false;
    return Math.ceil((new Date(r.response_deadline).getTime() - Date.now()) / 86400000) <= 14;
  }).length;

  const columns: Column<LeaseRenewal>[] = [
    { key: 'tenant_name', header: 'Tenant' },
    { key: 'property_name', header: 'Property' },
    {
      key: 'rent',
      header: 'Rent Change',
      render: (r) => (
        <span>
          ${r.current_rent.toLocaleString()} → <strong>${r.proposed_rent.toLocaleString()}</strong>
          <span className={r.rent_change_amount >= 0 ? 'text-red-500 ml-1' : 'text-green-500 ml-1'}>
            ({r.rent_change_amount >= 0 ? '+' : ''}${r.rent_change_amount.toLocaleString()})
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'response_deadline',
      header: 'Deadline',
      render: (r) => r.response_deadline ? new Date(r.response_deadline).toLocaleDateString() : '—',
    },
  ];

  async function doAction(action: string, fn: () => Promise<void>) {
    setActionMsg(null);
    try {
      await fn();
      setSelected(null);
      refetch();
      setActionMsg({ type: 'success', text: action });
    } catch (err: any) {
      setActionMsg({ type: 'error', text: err?.message || 'Failed' });
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={RefreshCw} title="Lease Renewals" description="Renewal offers, responses, and approvals" />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pending Offers" value={pending} color="blue" />
        <StatCard label="Accepted (Awaiting Approval)" value={accepted} color="green" />
        <StatCard label="Expiring < 14 Days" value={expiringSoon} color="amber" />
      </div>

      {actionMsg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${actionMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMsg.text}
        </div>
      )}

      <DataTable columns={columns} data={renewals} loading={loading} onRowClick={setSelected} emptyMessage="No renewal offers" />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={`Renewal: ${selected?.tenant_name || ''}`} wide>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Property" value={selected.property_name} />
              <Detail label="Status" value={selected.status.replace(/_/g, ' ')} />
              <Detail label="Current Rent" value={`$${selected.current_rent.toLocaleString()}`} />
              <Detail label="Proposed Rent" value={`$${selected.proposed_rent.toLocaleString()}`} />
              <Detail label="Change" value={`${selected.rent_change_amount >= 0 ? '+' : ''}$${selected.rent_change_amount.toLocaleString()}`} />
              <Detail label="Term" value={`${selected.proposed_term_months} months`} />
              <Detail label="Offered" value={selected.offered_at ? new Date(selected.offered_at).toLocaleDateString() : '—'} />
              <Detail label="Deadline" value={selected.response_deadline ? new Date(selected.response_deadline).toLocaleDateString() : '—'} />
              {selected.counter_rent && <Detail label="Counter Offer" value={`$${selected.counter_rent.toLocaleString()}`} />}
            </div>

            <RoleGate minRole="senior_manager">
              <div className="flex gap-2 border-t border-gray-200 pt-3">
                {selected.status === 'offered' && (
                  <>
                    <Button variant="primary" onClick={() => doAction('Renewal accepted', () => api.post(`/api/renewals/${selected.id}/respond`, { response: 'accept' }))}>
                      <Check className="h-4 w-4" /> Accept
                    </Button>
                    <Button variant="danger" onClick={() => doAction('Renewal declined', () => api.post(`/api/renewals/${selected.id}/respond`, { response: 'decline' }))}>
                      <X className="h-4 w-4" /> Decline
                    </Button>
                  </>
                )}
                {(selected.status === 'accepted' || selected.status === 'counter_offered') && (
                  <Button variant="primary" onClick={() => doAction('Renewal approved — lease extended', () => api.post(`/api/renewals/${selected.id}/approve`))}>
                    <ArrowRightLeft className="h-4 w-4" /> Approve & Extend Lease
                  </Button>
                )}
              </div>
            </RoleGate>
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = { blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700' };
  return (
    <div className={`rounded-xl border border-gray-200 p-4 ${colors[color] || 'bg-gray-50 text-gray-700'}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium opacity-75">{label}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><p className="text-xs text-gray-400">{label}</p><p className="text-sm text-gray-900">{value || '—'}</p></div>;
}
