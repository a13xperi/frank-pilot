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
    <>
      <div className="flex items-center justify-between">
        <p className="text-2xs font-semibold uppercase text-gray-500">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-200/50">
          <Icon className="h-4 w-4 text-brand-600" />
        </span>
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-8 tracking-tight text-gray-900 tabular-nums">
        {loading ? <span className="inline-block h-7 w-12 animate-pulse rounded-md bg-gray-100" /> : value}
      </p>
    </>
  );

  if (!to) {
    return <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-card">{inner}</div>;
  }

  return (
    <Link
      to={to}
      className="block rounded-xl border border-gray-200 bg-white p-5 shadow-card transition-all hover:-translate-y-px hover:border-brand-300/60 hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
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
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">
          Welcome back, {user.firstName}
        </h1>
        <p className="mt-1 text-13 text-gray-500">
          {formatRole(user.role)} &middot; CDPC Nevada
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileText} label="Active Applications" value={activeCount} loading={apps.loading} to="/applications" />
        <RoleGate minRole="senior_manager">
          <StatCard icon={UserPlus} label="Signups" value={signups.data?.registered ?? '--'} loading={signups.loading} to="/applications" />
        </RoleGate>
        <RoleGate minRole="senior_manager">
          <StatCard icon={Search} label="Pending Screening" value={screeningCount} loading={apps.loading} to="/screening" />
        </RoleGate>
        <RoleGate minRole="senior_manager">
          <StatCard icon={CheckCircle} label="Pending Approvals" value={approvalCount} loading={apps.loading} to="/approvals" />
        </RoleGate>
        <StatCard icon={Building2} label="Properties" value={props.data?.total ?? '--'} loading={props.loading} to="/properties" />
      </div>

      <RoleGate minRole="regional_manager">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
            <Clock className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold tracking-tight text-gray-900">Recent Activity</h2>
          </div>
          {audit.loading ? (
            <div className="space-y-2 p-5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-gray-100" />
              ))}
            </div>
          ) : (audit.data?.logs || []).length === 0 ? (
            <p className="p-5 text-13 text-gray-500">No recent activity</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {(audit.data?.logs || []).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between px-5 py-2.5 transition-colors hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={entry.action} />
                    <span className="text-13 text-gray-600">
                      {formatRole(entry.actor_role as 'leasing_agent')}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums">
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
