import { FileText, Search, CheckCircle, Building2, Clock, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useApiQuery } from '@/hooks/useApiQuery';
import { RoleGate } from '@/components/RoleGate';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRole, hasMinRole, type ApplicationListResponse, type PropertyListResponse, type AuditLogResponse, type SignupStatsResponse } from '@/types';
import type { LucideIcon } from 'lucide-react';

function StatCard({ icon: Icon, label, value, loading, to }: { icon: LucideIcon; label: string; value: string | number; loading?: boolean; to?: string }) {
  const inner = (
    <div className="flex items-center gap-3">
      <div className="rounded-lg bg-emerald-50 p-2">
        <Icon className="h-5 w-5 text-emerald-600" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-semibold text-gray-900">
          {loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-gray-200" /> : value}
        </p>
      </div>
    </div>
  );

  if (!to) {
    return <div className="rounded-xl border border-gray-200 bg-white p-5">{inner}</div>;
  }

  return (
    <Link
      to={to}
      className="block rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-emerald-300 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      {inner}
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const apps = useApiQuery<ApplicationListResponse>('/api/applications');
  const props = useApiQuery<PropertyListResponse>('/api/properties');
  const audit = useApiQuery<AuditLogResponse>(
    user && hasMinRole(user.role, 'regional_manager') ? '/api/audit?limit=10' : null
  );
  const signups = useApiQuery<SignupStatsResponse>(
    user && hasMinRole(user.role, 'senior_manager') ? '/api/users/signup-stats' : null
  );

  if (!user) return null;

  const allApps = apps.data?.applications || [];
  const activeCount = allApps.filter((a) => !['cancelled', 'onboarded'].includes(a.status)).length;
  const screeningCount = allApps.filter((a) => a.status === 'submitted').length;
  const approvalCount = allApps.filter((a) =>
    ['screening_passed', 'tier1_review', 'tier1_approved', 'tier2_review', 'tier2_approved', 'tier3_review'].includes(a.status)
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Welcome back, {user.firstName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {formatRole(user.role)} &middot; CDPC Nevada
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileText} label="Active Applications" value={activeCount} loading={apps.loading} to="/applications" />
        <RoleGate minRole="senior_manager">
          <StatCard icon={UserPlus} label="Signups" value={signups.data?.registered ?? '—'} loading={signups.loading} to="/applications" />
        </RoleGate>
        <RoleGate minRole="senior_manager">
          <StatCard icon={Search} label="Pending Screening" value={screeningCount} loading={apps.loading} to="/screening" />
        </RoleGate>
        <RoleGate minRole="senior_manager">
          <StatCard icon={CheckCircle} label="Pending Approvals" value={approvalCount} loading={apps.loading} to="/approvals" />
        </RoleGate>
        <StatCard icon={Building2} label="Properties" value={props.data?.total ?? '—'} loading={props.loading} to="/properties" />
      </div>

      <RoleGate minRole="regional_manager">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-medium text-gray-900">Recent Activity</h2>
          </div>
          {audit.loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : (audit.data?.logs || []).length === 0 ? (
            <p className="text-sm text-gray-500">No recent activity</p>
          ) : (
            <div className="space-y-2">
              {(audit.data?.logs || []).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={entry.action} />
                    <span className="text-sm text-gray-600">
                      {formatRole(entry.actor_role as 'leasing_agent')}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </RoleGate>
    </div>
  );
}
