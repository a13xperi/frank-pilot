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
      <p className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="font-serif text-3xl font-semibold tabular-nums text-gray-900">
          {loading ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-gray-200" /> : value}
        </p>
        <div className="rounded-full border border-brand-200 bg-brand-50 p-2">
          <Icon className="h-4 w-4 text-brand-700" />
        </div>
      </div>
    </>
  );

  if (!to) {
    return <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">{inner}</div>;
  }

  return (
    <Link
      to={to}
      className="block rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-brand-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-8">
      <div className="border-b border-gray-200 pb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand-700">
          {today}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-gray-900">
          Welcome back, {user.firstName}
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          {formatRole(user.role)} &middot; CDPC Nevada
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
        <div className="rounded-lg border border-gray-200 bg-white p-6 sm:p-8">
          <div className="flex items-center gap-2.5 border-b-2 border-gray-300 pb-4">
            <Clock className="h-5 w-5 text-brand-700" />
            <h2 className="font-serif text-xl font-semibold text-gray-900">Recent Activity</h2>
          </div>
          {audit.loading ? (
            <div className="space-y-2 pt-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : (audit.data?.logs || []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="rounded-full border border-gray-200 bg-gray-50 p-2.5">
                <Clock className="h-5 w-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-600">No recent activity</p>
              <p className="text-xs text-gray-500">
                Actions taken across the pipeline will be recorded here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {(audit.data?.logs || []).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={entry.action} />
                    <span className="text-sm text-gray-600">
                      {formatRole(entry.actor_role as 'leasing_agent')}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-gray-400">
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
