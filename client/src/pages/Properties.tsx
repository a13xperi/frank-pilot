import { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useForm } from '@/hooks/useForm';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { RoleGate } from '@/components/RoleGate';
import { api } from '@/api/client';
import { getPropertyPhoto } from '@/utils/propertyPhoto';
import type { Property, PropertyListResponse } from '@/types';

const TYPE_LABELS: Record<string, string> = { senior: 'Senior', family: 'Family', mixed_use: 'Mixed' };

const columns: Column<Property>[] = [
  {
    key: 'photo',
    header: '',
    className: 'w-16 pr-0',
    render: (r) => (
      <img
        src={getPropertyPhoto(r.photoUrl)}
        alt=""
        loading="lazy"
        className="h-10 w-10 rounded-lg object-cover ring-1 ring-gray-200"
      />
    ),
  },
  { key: 'name', header: 'Name' },
  {
    key: 'type',
    header: 'Type',
    render: (r) => TYPE_LABELS[r.propertyType] || r.propertyType,
  },
  {
    key: 'address',
    header: 'Address',
    render: (r) => `${r.addressLine1}, ${r.city}`,
  },
  { key: 'unitCount', header: 'Units', className: 'text-right' },
  { key: 'totalVacancy', header: 'Vacant', className: 'text-right' },
  { key: 'jurisdiction', header: 'Jurisdiction' },
];

const EMPTY_FORM = {
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  unitCount: '',
  amiArea: '',
  onesitePropertyId: '',
  loftPropertyId: '',
};

export function Properties() {
  const { user } = useAuth();
  const { data, loading, refetch } = useApiQuery<PropertyListResponse>('/api/properties');
  const [showCreate, setShowCreate] = useState(false);
  const [editProp, setEditProp] = useState<Property | null>(null);

  const createForm = useForm(EMPTY_FORM, async (values) => {
    await api.post('/api/properties', {
      ...values,
      unitCount: Number(values.unitCount),
      addressLine2: values.addressLine2 || undefined,
      onesitePropertyId: values.onesitePropertyId || undefined,
      loftPropertyId: values.loftPropertyId || undefined,
    });
    setShowCreate(false);
    createForm.reset();
    refetch();
  });

  const editForm = useForm(
    {
      name: editProp?.name || '',
      unitCount: String(editProp?.unitCount || ''),
      amiArea: editProp?.amiArea || '',
      onesitePropertyId: editProp?.onesitePropertyId || '',
      loftPropertyId: editProp?.loftPropertyId || '',
    },
    async (values) => {
      if (!editProp) return;
      await api.patch(`/api/properties/${editProp.id}`, {
        name: values.name,
        unitCount: Number(values.unitCount),
        amiArea: values.amiArea,
        onesitePropertyId: values.onesitePropertyId || undefined,
        loftPropertyId: values.loftPropertyId || undefined,
      });
      setEditProp(null);
      refetch();
    }
  );

  if (!user) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Building2}
        title="Properties"
        description="Manage rental properties, AMI areas, and integration IDs"
        action={
          <RoleGate minRole="asset_manager">
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Add Property
            </Button>
          </RoleGate>
        }
      />

      <DataTable
        columns={columns}
        data={data?.properties || []}
        loading={loading}
        onRowClick={(p) => setEditProp(p)}
        emptyMessage="No properties found"
      />

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Property" wide>
        <form onSubmit={createForm.handleSubmit} className="space-y-3">
          <Input label="Name" name="name" value={createForm.values.name} onChange={createForm.handleChange} required />
          <Input label="Address" name="addressLine1" value={createForm.values.addressLine1} onChange={createForm.handleChange} required />
          <Input label="Address Line 2" name="addressLine2" value={createForm.values.addressLine2} onChange={createForm.handleChange} />
          <div className="grid grid-cols-3 gap-3">
            <Input label="City" name="city" value={createForm.values.city} onChange={createForm.handleChange} required />
            <Input label="State" name="state" value={createForm.values.state} onChange={createForm.handleChange} required maxLength={2} />
            <Input label="ZIP" name="zip" value={createForm.values.zip} onChange={createForm.handleChange} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit Count" name="unitCount" type="number" value={createForm.values.unitCount} onChange={createForm.handleChange} required />
            <Input label="AMI Area" name="amiArea" value={createForm.values.amiArea} onChange={createForm.handleChange} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="OneSite ID" name="onesitePropertyId" value={createForm.values.onesitePropertyId} onChange={createForm.handleChange} />
            <Input label="Loft ID" name="loftPropertyId" value={createForm.values.loftPropertyId} onChange={createForm.handleChange} />
          </div>
          {createForm.error && <p className="text-sm text-red-600">{createForm.error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={createForm.submitting}>
              {createForm.submitting ? 'Creating...' : 'Create Property'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editProp} onClose={() => setEditProp(null)} title={`Edit: ${editProp?.name || ''}`}>
        <form onSubmit={editForm.handleSubmit} className="space-y-3">
          <Input label="Name" name="name" value={editForm.values.name} onChange={editForm.handleChange} required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Unit Count" name="unitCount" type="number" value={editForm.values.unitCount} onChange={editForm.handleChange} required />
            <Input label="AMI Area" name="amiArea" value={editForm.values.amiArea} onChange={editForm.handleChange} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="OneSite ID" name="onesitePropertyId" value={editForm.values.onesitePropertyId} onChange={editForm.handleChange} />
            <Input label="Loft ID" name="loftPropertyId" value={editForm.values.loftPropertyId} onChange={editForm.handleChange} />
          </div>
          {editProp && (
            <p className="text-xs text-gray-400">Address: {editProp.addressLine1}, {editProp.city}, {editProp.state} {editProp.zip} (immutable)</p>
          )}
          {editForm.error && <p className="text-sm text-red-600">{editForm.error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditProp(null)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={editForm.submitting}>
              {editForm.submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Input({
  label, name, value, onChange, type = 'text', required, maxLength,
}: {
  label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string; required?: boolean; maxLength?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        maxLength={maxLength}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
    </div>
  );
}
