import { useState } from 'react';
import { Shield } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/PageHeader';
import { hasMinRole, type PropertyListResponse } from '@/types';

interface FairHousingReport {
  generatedAt: string;
  propertyId: string | null;
  decisions: {
    totalApplications: number;
    screening: { passed: number; failed: number; reviewRequired: number; pending: number };
    approvals: { approved: number; denied: number; inProgress: number };
  };
  adverseActionCompleteness: {
    totalDenials: number;
    noticesOnFile: number;
    completenessPercent: number;
    missingNotices: number;
  };
  objectiveCriteria: string[];
  protectedClassNotice: string;
}

function StatBlock({ label, value, suffix }: { label: string; value: number | string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
      <p className="text-2xl font-semibold text-gray-900">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix && <span className="text-sm font-normal text-gray-400">{suffix}</span>}
      </p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </div>
  );
}

export function Compliance() {
  const { user } = useAuth();
  const [propertyId, setPropertyId] = useState('');
  const props = useApiQuery<PropertyListResponse>('/api/properties');

  const reportPath = propertyId
    ? `/api/compliance/fair-housing?propertyId=${propertyId}`
    : '/api/compliance/fair-housing';

  const { data: report, loading, error } = useApiQuery<FairHousingReport>(
    user && hasMinRole(user.role, 'regional_manager') ? reportPath : null
  );

  if (!user || !hasMinRole(user.role, 'regional_manager')) {
    return <p className="text-sm text-red-600">Access denied. Regional Manager or above required.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Shield}
        title="Compliance"
        description="Fair Housing Act reports (42 U.S.C. 3601-3619)"
      />

      <div className="flex gap-3">
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Properties</option>
          {(props.data?.properties || []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-200" />)}
        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</div>}

      {report && (
        <>
          <div>
            <h2 className="mb-3 text-sm font-medium text-gray-600 uppercase tracking-wider">Application Decisions</h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <StatBlock label="Total Applications" value={report.decisions.totalApplications} />
              <StatBlock label="Screening Passed" value={report.decisions.screening.passed} />
              <StatBlock label="Approved" value={report.decisions.approvals.approved} />
              <StatBlock label="Denied" value={report.decisions.approvals.denied} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-gray-600 uppercase tracking-wider">FCRA Adverse Action</h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <StatBlock label="Total Denials" value={report.adverseActionCompleteness.totalDenials} />
              <StatBlock label="Notices on File" value={report.adverseActionCompleteness.noticesOnFile} />
              <StatBlock label="Completeness" value={report.adverseActionCompleteness.completenessPercent.toFixed(1)} suffix="%" />
              <StatBlock label="Missing Notices" value={report.adverseActionCompleteness.missingNotices} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-gray-600 uppercase tracking-wider">Objective Screening Criteria</h2>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <ul className="space-y-2">
                {report.objectiveCriteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
            <h3 className="text-sm font-medium text-blue-800 mb-1">Protected Class Notice</h3>
            <p className="text-sm text-blue-700">{report.protectedClassNotice}</p>
          </div>

          <p className="text-xs text-gray-400">
            Report generated: {new Date(report.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
