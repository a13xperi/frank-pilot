import { useState, useCallback } from 'react';
import { ScrollText, Link as LinkIcon } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { DataTable, type Column } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { api } from '@/api/client';
import { hasMinRole, formatRole, type AuditLogResponse, type AuditEntry } from '@/types';

// ── Types mirroring src/modules/tape/types.ts (client-side copy) ─────────────
interface TapeJsonLdPayload {
  '@context': string | string[];
  '@type': string;
  actorId: string | null;
  subjectId: string | null;
  ruleCitation: string;
  evidence?: Record<string, unknown>;
  [extra: string]: unknown;
}

interface TapeEntry {
  id: string;
  sequence: number;
  kind: string;
  citation: string;
  applicantId: string | null;
  payload: TapeJsonLdPayload;
  prevHash: string;
  entryHash: string;
  createdAt: string;
  sessionId: string | null;
}

interface ListTapeResponse {
  scope: { type: 'applicant'; applicantId: string };
  entries: TapeEntry[];
  hasMore: boolean;
}

interface VerifyResult {
  ok: boolean;
  scope: { type: 'applicant'; applicantId: string } | { type: 'global' };
  lastSequence: number;
  brokeAt?: number;
  reason?: string;
}

// ── Existing audit-log table columns (unchanged) ──────────────────────────────
const columns: Column<AuditEntry>[] = [
  {
    key: 'created_at',
    header: 'Time',
    render: (r) => new Date(r.created_at).toLocaleString(),
    className: 'whitespace-nowrap',
  },
  {
    key: 'action',
    header: 'Action',
    render: (r) => (
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono">
        {r.action}
      </span>
    ),
  },
  {
    key: 'actor_role',
    header: 'Actor',
    render: (r) => formatRole(r.actor_role as 'leasing_agent'),
  },
  { key: 'resource_type', header: 'Resource' },
  {
    key: 'details',
    header: 'Details',
    render: (r) => {
      const d = r.details;
      if (!d || Object.keys(d).length === 0) return '—';
      const summary = Object.entries(d)
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      return <span className="text-xs text-gray-500">{summary}</span>;
    },
  },
];

// ── Compliance Tape panel ─────────────────────────────────────────────────────

function truncateJson(obj: unknown, maxLen = 120): string {
  const s = JSON.stringify(obj);
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function ComplianceTapePanel() {
  const [inputValue, setInputValue] = useState('');
  const [applicantId, setApplicantId] = useState('');

  // Tape list
  const tapeQuery = useApiQuery<ListTapeResponse>(
    applicantId ? `/api/compliance-tape?applicantId=${encodeURIComponent(applicantId)}` : null,
  );

  // Verify state (manual trigger)
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // PDF export state
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleSearch = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed !== applicantId) {
      setApplicantId(trimmed);
      setVerifyResult(null);
      setVerifyError(null);
      setExportError(null);
    }
  }, [inputValue, applicantId]);

  const handleVerify = useCallback(async () => {
    if (!applicantId) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    setVerifyError(null);
    try {
      const result = await api.get<VerifyResult>(
        `/api/compliance-tape/verify?applicantId=${encodeURIComponent(applicantId)}`,
      );
      setVerifyResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setVerifyError(msg);
    } finally {
      setVerifyLoading(false);
    }
  }, [applicantId]);

  const handleExportPdf = useCallback(async () => {
    if (!applicantId) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const token = localStorage.getItem('frank_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        `/api/compliance-tape/export.pdf?applicantId=${encodeURIComponent(applicantId)}`,
        { headers },
      );

      if (!res.ok) {
        if (res.status === 501) {
          setExportError('Global tape view not available in v1 — filter by applicant.');
          return;
        }
        setExportError(`Could not export PDF (HTTP ${res.status}).`);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      const filename = match ? decodeURIComponent(match[1]) : `compliance-tape-${applicantId}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  }, [applicantId]);

  // Derived render state
  const entries = tapeQuery.data?.entries ?? [];
  const tapeLoading = tapeQuery.loading;
  const tapeError = tapeQuery.error;

  // Detect global-scope 501 message surfaced through the error string
  const isGlobalScopeError =
    tapeError?.toLowerCase().includes('global_scope_not_implemented') ||
    tapeError?.toLowerCase().includes('501');

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      {/* Section heading */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-emerald-600" />
          Compliance Tape
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Tape entries are append-only, hash-chained per applicant scope.
          See <span className="font-mono">docs/bp-02-contracts.md</span>.
        </p>
      </div>

      {/* Filter row */}
      <div className="flex gap-3 items-center">
        <input
          placeholder="Applicant ID…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-80 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <Button
          variant="primary"
          onClick={handleSearch}
          disabled={!inputValue.trim()}
        >
          Search
        </Button>
      </div>

      {/* Only show table area when an applicant ID has been searched */}
      {applicantId && (
        <div className="space-y-3">
          {/* Table header row with action buttons */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-medium text-gray-700">
              Tape entries for applicant{' '}
              <span className="font-mono text-gray-900">{applicantId}</span>
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Verify Chain button + result badge */}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleVerify}
                disabled={verifyLoading || tapeLoading}
                loading={verifyLoading}
              >
                {verifyLoading ? 'Verifying…' : 'Verify Chain'}
              </Button>
              {verifyResult && verifyResult.ok && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                  Verified ✓ (sequence {verifyResult.lastSequence})
                </span>
              )}
              {verifyResult && !verifyResult.ok && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                  Break at sequence {verifyResult.brokeAt ?? '?'}{verifyResult.reason ? ` — ${verifyResult.reason}` : ''}
                </span>
              )}
              {verifyError && (
                <span className="text-xs text-red-600">{verifyError}</span>
              )}

              {/* Export PDF button */}
              <button
                onClick={handleExportPdf}
                disabled={exportLoading || tapeLoading || entries.length === 0}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {exportLoading ? 'Exporting…' : 'Export PDF'}
              </button>
              {exportError && (
                <span className="text-xs text-red-600">{exportError}</span>
              )}
            </div>
          </div>

          {/* Loading state */}
          {tapeLoading && (
            <p className="text-sm text-gray-500 py-4">Loading…</p>
          )}

          {/* Global-scope 501 */}
          {!tapeLoading && isGlobalScopeError && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              Global tape view not available in v1 — filter by applicant.
            </div>
          )}

          {/* Generic error */}
          {!tapeLoading && tapeError && !isGlobalScopeError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              Could not load tape ({tapeError}).
            </div>
          )}

          {/* Empty state */}
          {!tapeLoading && !tapeError && entries.length === 0 && (
            <p className="text-sm text-gray-500 py-4">
              No tape entries for this applicant yet.
            </p>
          )}

          {/* Tape entries table */}
          {!tapeLoading && !tapeError && entries.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      Seq
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Kind
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Citation
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Created At
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Evidence
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 transition-colors"
                      title={`entry_hash: ${entry.entryHash}`}
                    >
                      <td className="px-4 py-3 text-gray-900 font-mono text-xs">
                        {entry.sequence}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono">
                          {entry.kind}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {entry.citation}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <code className="block rounded bg-gray-50 px-2 py-1 text-xs text-gray-700 break-all">
                          {truncateJson(entry.payload.evidence ?? entry.payload)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* hasMore hint */}
          {tapeQuery.data?.hasMore && (
            <p className="text-xs text-gray-400">
              More entries exist past the last row — use the API directly to paginate.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AuditLog() {
  const { user } = useAuth();
  const [applicationId, setApplicationId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const limit = 25;

  const queryParams = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (applicationId) queryParams.set('applicationId', applicationId);
  if (action) queryParams.set('action', action);

  const { data, loading } = useApiQuery<AuditLogResponse>(
    user && hasMinRole(user.role, 'regional_manager') ? `/api/audit?${queryParams}` : null
  );

  if (!user || !hasMinRole(user.role, 'regional_manager')) {
    return <p className="text-sm text-red-600">Access denied. Regional Manager or above required.</p>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ScrollText}
        title="Audit Log"
        description="Immutable record of all system actions"
      />

      <div className="flex gap-3">
        <input
          placeholder="Filter by Application ID..."
          value={applicationId}
          onChange={(e) => { setApplicationId(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-72 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Actions</option>
          <option value="application_created">Application Created</option>
          <option value="application_submitted">Application Submitted</option>
          <option value="screening_initiated">Screening Initiated</option>
          <option value="tier1_approved">Tier 1 Approved</option>
          <option value="tier1_denied">Tier 1 Denied</option>
          <option value="tier2_approved">Tier 2 Approved</option>
          <option value="tier2_denied">Tier 2 Denied</option>
          <option value="tier3_approved">Tier 3 Approved</option>
          <option value="tier3_denied">Tier 3 Denied</option>
          <option value="fraud_flag_raised">Fraud Flag Raised</option>
          <option value="fraud_flag_resolved">Fraud Flag Resolved</option>
          <option value="lease_generated">Lease Generated</option>
          <option value="tenant_onboarded">Tenant Onboarded</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={data?.logs || []}
        loading={loading}
        emptyMessage="No audit entries found"
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Showing {page * limit + 1}–{page * limit + (data?.logs?.length || 0)}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={(data?.logs?.length || 0) < limit}
          >
            Next
          </Button>
        </div>
      </div>

      {/* ── Compliance Tape panel (appended below existing audit log) ── */}
      <ComplianceTapePanel />
    </div>
  );
}
