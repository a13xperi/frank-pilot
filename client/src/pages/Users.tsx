import { useState } from 'react';
import { Users as UsersIcon, Plus, RotateCcw } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useForm } from '@/hooks/useForm';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { api } from '@/api/client';
import { hasMinRole, formatRole, type StaffUser, type UserListResponse, type UserRole } from '@/types';

const columns: Column<StaffUser>[] = [
  { key: 'name', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}` },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role', render: (r) => formatRole(r.role) },
  {
    key: 'isActive',
    header: 'Status',
    render: (r) => <StatusBadge status={r.isActive ? 'active' : 'inactive'} />,
  },
];

const EMPTY_FORM = {
  email: '', password: '', firstName: '', lastName: '', role: 'leasing_agent' as UserRole,
};

export function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, refetch } = useApiQuery<UserListResponse>('/api/users');
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<StaffUser | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const form = useForm(EMPTY_FORM, async (values) => {
    await api.post('/api/users', values);
    setShowCreate(false);
    form.reset();
    refetch();
    toast.success('Staff user created');
  });

  if (!user || !hasMinRole(user.role, 'senior_manager')) {
    return <p className="text-sm text-red-600">Access denied. Senior Manager or above required.</p>;
  }

  const filtered = (data?.users || []).filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (activeFilter === 'true' && !u.isActive) return false;
    if (activeFilter === 'false' && u.isActive) return false;
    return true;
  });

  async function toggleActive(u: StaffUser) {
    setActionLoading(true);
    try {
      await api.patch(`/api/users/${u.id}/${u.isActive ? 'deactivate' : 'activate'}`, {});
      refetch();
      toast.success(`${u.firstName} ${u.lastName} ${u.isActive ? 'deactivated' : 'activated'}`);
    } catch {
      toast.error('Could not update user status');
    } finally {
      setActionLoading(false);
      setSelected(null);
    }
  }

  async function resetPassword(u: StaffUser) {
    const pw = prompt('Enter new password (min 8 characters):');
    if (!pw || pw.length < 8) return;
    setActionLoading(true);
    try {
      await api.post(`/api/users/${u.id}/reset-password`, { newPassword: pw });
      toast.success('Password reset successfully');
    } catch {
      toast.error('Could not reset password');
    } finally {
      setActionLoading(false);
      setSelected(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={UsersIcon}
        title="Users"
        description="Manage staff accounts, roles, and access"
        action={
          <RoleGate minRole="system_admin">
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Add User
            </Button>
          </RoleGate>
        }
      />

      <div className="flex gap-3">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Roles</option>
          <option value="leasing_agent">Leasing Agent</option>
          <option value="senior_manager">Senior Manager</option>
          <option value="regional_manager">Regional Manager</option>
          <option value="asset_manager">Asset Manager</option>
          <option value="system_admin">System Admin</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        onRowClick={(u) => setSelected(u)}
        emptyMessage="No users found"
      />

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Staff User">
        <form onSubmit={form.handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">First Name</label>
              <input name="firstName" value={form.values.firstName} onChange={form.handleChange} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Last Name</label>
              <input name="lastName" value={form.values.lastName} onChange={form.handleChange} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input name="email" type="email" value={form.values.email} onChange={form.handleChange} required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input name="password" type="password" value={form.values.password} onChange={form.handleChange} required minLength={8} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Role</label>
            <select name="role" value={form.values.role} onChange={form.handleChange} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
              <option value="leasing_agent">Leasing Agent</option>
              <option value="senior_manager">Senior Manager</option>
              <option value="regional_manager">Regional Manager</option>
              <option value="asset_manager">Asset Manager</option>
              <option value="system_admin">System Admin</option>
            </select>
          </div>
          {form.error && <p className="text-sm text-red-600">{form.error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={form.submitting}>Create User</Button>
          </div>
        </form>
      </Modal>

      {/* User Detail Modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.firstName} ${selected.lastName}` : ''}>
        {selected && (
          <div className="space-y-4">
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Email:</span> {selected.email}</p>
              <p><span className="text-gray-500">Role:</span> {formatRole(selected.role)}</p>
              <p><span className="text-gray-500">Status:</span> <StatusBadge status={selected.isActive ? 'active' : 'inactive'} /></p>
              <p><span className="text-gray-500">Created:</span> {new Date(selected.createdAt).toLocaleDateString()}</p>
            </div>
            <RoleGate minRole="system_admin">
              <div className="flex gap-2 border-t border-gray-200 pt-4">
                <Button
                  variant={selected.isActive ? 'danger' : 'primary'}
                  size="sm"
                  loading={actionLoading}
                  onClick={() => toggleActive(selected)}
                >
                  {selected.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={actionLoading}
                  onClick={() => resetPassword(selected)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset Password
                </Button>
              </div>
            </RoleGate>
          </div>
        )}
      </Modal>
    </div>
  );
}
