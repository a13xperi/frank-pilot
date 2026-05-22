import { Link } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { hasMinRole } from '@/types';

export interface QaBundleSummary {
  stem: string;
  slug: string;
  capturedAt: string;
  urls: {
    png: string | null;
    json: string;
    replay: string | null;
  };
}

interface QaBundlesResponse {
  bundles: QaBundleSummary[];
  hint?: string;
}

const columns: Column<QaBundleSummary>[] = [
  {
    key: 'capturedAt',
    header: 'Captured',
    render: (r) => new Date(r.capturedAt).toLocaleString(),
    className: 'whitespace-nowrap',
  },
  {
    key: 'slug',
    header: 'Slug',
    render: (r) => (
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono">
        {r.slug}
      </span>
    ),
  },
  {
    key: 'replay',
    header: 'Replay',
    render: (r) =>
      r.urls.replay ? (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          ✓
        </span>
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
  {
    key: 'view',
    header: '',
    render: (r) => (
      <Link
        to={`/qa-bundles/${r.stem}`}
        className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
      >
        View →
      </Link>
    ),
    className: 'whitespace-nowrap text-right',
  },
];

export function QaBundles() {
  const { user } = useAuth();
  const gated = !!user && hasMinRole(user.role, 'regional_manager');

  const { data, loading, error } = useApiQuery<QaBundlesResponse>(
    gated ? '/api/qa/bundles' : null,
  );

  if (!user || !hasMinRole(user.role, 'regional_manager')) {
    return (
      <p className="text-sm text-red-600">
        Access denied. Regional Manager or above required.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Camera}
        title="QA Bundles"
        description="Operator viewer for camera-button capture bundles (PNG + JSON sidecar + rrweb replay)."
      />

      {data?.hint && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          {data.hint}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Could not load bundles ({error}).
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.bundles ?? []}
        loading={loading}
        emptyMessage="No QA bundles uploaded yet."
      />
    </div>
  );
}
