import { FileText, Search, CheckCircle, Building2, Clock, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useApiQuery } from '@/hooks/useApiQuery';
import { RoleGate } from '@/components/RoleGate';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRole, hasMinRole, type ApplicationListResponse, type PropertyListResponse, type AuditLogResponse, type SignupStatsResponse } from '@/types';
import type { LucideIcon } from 'lucide-react';

type StatTint = 'brand' | 'terracotta' | 'amber' | 'sky';

const TINTS: Record<StatTint, { chip: string; icon: string }> = {
  brand: { chip: 'bg-brand-100', icon: 'text-brand-700' },
  terracotta: { chip: 'bg-orange-100', icon: 'text-orange-700' },
  amber: { chip: 'bg-amber-100', icon: 'text-amber-700' },
  sky: { chip: 'bg-sky-100', icon: 'text-sky-700' },
};

function StatCard({ icon: Icon, label, value, loading, to, tint = 'brand' }: { icon: LucideIcon; label: string; value: string | number; loading?: boolean; to?: string; tint?: StatTint }) {
  const t = TINTS[tint];
  const inner = (
    <div className="flex items-center gap-3.5">
      <div className={`rounded-xl p-2.5 ${t.chip}`}>
        <Icon className={`h-5 w-5 ${t.icon}`} />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="font-display text-2xl font-semibold tracking-tight text-gray-900">
          {loading ? <span className="inline-block h-6 w-10 animate-pulse rounded bg-gray-200" /> : value}
        </p>
      </div>
    </div>
  );

  if (!to) {
    return <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">{inner}</div>;
  }

  return (
    <Link
      to={to}
      className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
        <h1 className="font-display text-3xl font-semibold tracking-tight text-gray-900">
          Welcome back, {user.firstName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {formatRole(user.role)} &middot; CDPC Nevada
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileText} label="Active Applications" value={activeCount} loading={apps.loading} to="/applications" tint="brand" />
        <RoleGate minRole="senior_manager">
          <StatCard icon={UserPlus} label="Signups" value={signups.data?.registered ?? '--'} loading={signups.loading} to="/applications" tint="terracotta" />
        </RoleGate>
        <RoleGate minRole="senior_manager">
          <StatCard icon={Search} label="Pending Screening" value={screeningCount} loading={apps.loading} to="/screening" tint="amber" />
        </RoleGate>
        <RoleGate minRole="senior_manager">
          <StatCard icon={CheckCircle} label="Pending Approvals" value={approvalCount} loading={apps.loading} to="/approvals" tint="sky" />
        </RoleGate>
        <StatCard icon={Building2} label="Properties" value={props.data?.total ?? '--'} loading={props.loading} to="/properties" tint="terracotta" />
      </div>

      <RoleGate minRole="regional_manager">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="rounded-lg bg-amber-100 p-1.5">
              <Clock className="h-4 w-4 text-amber-700" />
            </div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-gray-900">Recent Activity</h2>
          </div>
          {audit.loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : (audit.data?.logs || []).length === 0 ? (
            <p className="text-sm text-gray-500">All quiet for now — your team&rsquo;s recent actions will show up here.</p>
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
