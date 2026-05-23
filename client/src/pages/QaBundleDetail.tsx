import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Camera, ArrowLeft, Copy, Check } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { hasMinRole } from '@/types';
import type { QaBundleSummary } from './QaBundles';

interface BundleResponse {
  bundle: QaBundleSummary;
}

interface QaBufferFetch {
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  startedAt?: string;
  [k: string]: unknown;
}

interface QaBufferError {
  message?: string;
  stack?: string;
  type?: string;
  at?: string;
  [k: string]: unknown;
}

interface Sidecar {
  url?: string;
  viewport?: { width?: number; height?: number; dpr?: number };
  auth?: { claims?: Record<string, unknown> | null; [k: string]: unknown };
  flags?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  qaBuffer?: {
    fetch?: QaBufferFetch[];
    errors?: QaBufferError[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Copy-block intentionally returns the *stem only* — never the bucket URLs.
 * The public-URL clipboard buttons were removed in the #103 security follow-up:
 * sharing URLs publicly would re-introduce the very leak that motivated the
 * server-proxy refactor. Operators paste the stem into chat / tickets and
 * collaborators look it up via the gated /qa-bundles/:stem viewer.
 */
function clipboardBlock(b: QaBundleSummary): string {
  return b.stem;
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-lg border border-gray-200 bg-white"
    >
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        {title}
      </summary>
      <div className="border-t border-gray-100 px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

function PreJson({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function FetchTable({ rows }: { rows: QaBufferFetch[] }) {
  if (rows.length === 0) return <p className="text-xs text-gray-500">No fetch entries.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th className="px-3 py-2 font-medium">Method</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">URL</th>
            <th className="px-3 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((r, i) => {
            const status = r.status ?? 0;
            const statusClass =
              status >= 500
                ? 'text-red-700'
                : status >= 400
                  ? 'text-amber-700'
                  : 'text-gray-700';
            return (
              <tr key={i}>
                <td className="px-3 py-1.5 font-mono">{r.method ?? '—'}</td>
                <td className={`px-3 py-1.5 font-mono ${statusClass}`}>{status || '—'}</td>
                <td className="px-3 py-1.5 break-all text-gray-700">{r.url ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-gray-500">
                  {r.durationMs != null ? `${r.durationMs}ms` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ErrorsList({ rows }: { rows: QaBufferError[] }) {
  if (rows.length === 0)
    return <p className="text-xs text-gray-500">No errors captured.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((e, i) => (
        <li
          key={i}
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          <div className="font-mono font-medium">
            {e.type ?? 'error'}: {e.message ?? '(no message)'}
          </div>
          {e.at && <div className="mt-0.5 text-red-700">at {e.at}</div>}
          {e.stack && (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-red-700">
              {String(e.stack).slice(0, 1200)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReplayPanel({ stem }: { stem: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const token = localStorage.getItem('frank_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const [{ default: RrwebPlayer }, eventsRes] = await Promise.all([
          import('rrweb-player'),
          // CSS lives next to the JS bundle — import it for side effects.
          import('rrweb-player/dist/style.css'),
          fetch(`/api/qa/bundles/${encodeURIComponent(stem)}/replay`, { headers }),
        ]).then(async ([mod, _css, res]) => {
          if (!res.ok) throw new Error(`Replay fetch failed (HTTP ${res.status})`);
          const events = await res.json();
          return [mod, events] as const;
        });
        if (disposed || !containerRef.current) return;
        const events = eventsRes as unknown[];
        if (!Array.isArray(events) || events.length < 2) {
          setErr('Replay file is empty or malformed (rrweb needs ≥2 events).');
          return;
        }
        const instance = new (RrwebPlayer as unknown as new (opts: {
          target: HTMLElement;
          props: { events: unknown[]; autoPlay: boolean; width?: number; height?: number };
        }) => unknown)({
          target: containerRef.current,
          props: { events, autoPlay: false, width: 800, height: 480 },
        });
        cleanup = () => {
          // rrweb-player has no public destroy; clear the DOM.
          if (containerRef.current) containerRef.current.innerHTML = '';
          void instance;
        };
      } catch (e) {
        if (!disposed) setErr(e instanceof Error ? e.message : 'Replay failed to load');
      }
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [stem]);

  return (
    <div>
      {err && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}
      <div ref={containerRef} className="rounded-lg border border-gray-200 bg-white p-2" />
    </div>
  );
}

export function QaBundleDetail() {
  const { user } = useAuth();
  const { stem } = useParams<{ stem: string }>();
  const gated = !!user && hasMinRole(user.role, 'regional_manager');

  const { data, loading, error } = useApiQuery<BundleResponse>(
    gated && stem ? `/api/qa/bundles/${encodeURIComponent(stem)}` : null,
  );
  const bundle = data?.bundle ?? null;

  // Sidecar contents — fetched via the auth-gated server proxy so the bucket
  // can be flipped private. Bearer token attached via the api client style.
  const [sidecar, setSidecar] = useState<Sidecar | null>(null);
  const [sidecarErr, setSidecarErr] = useState<string | null>(null);
  useEffect(() => {
    if (!bundle) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('frank_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(
          `/api/qa/bundles/${encodeURIComponent(bundle.stem)}/sidecar`,
          { headers },
        );
        if (!res.ok) throw new Error(`Sidecar fetch failed (HTTP ${res.status})`);
        const json = (await res.json()) as Sidecar;
        if (!cancelled) setSidecar(json);
      } catch (e) {
        if (!cancelled)
          setSidecarErr(e instanceof Error ? e.message : 'Sidecar failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundle]);

  // PNG fetched via the auth-gated server proxy → blob URL we can stick into
  // `<img src>`. Without this dance the bearer token can't ride along.
  const [pngObjectUrl, setPngObjectUrl] = useState<string | null>(null);
  const [pngErr, setPngErr] = useState<string | null>(null);
  useEffect(() => {
    if (!bundle || !bundle.urls.png) {
      setPngObjectUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const url = await api.getBlobUrl(
          `/api/qa/bundles/${encodeURIComponent(bundle.stem)}/png`,
        );
        createdUrl = url;
        if (!cancelled) setPngObjectUrl(url);
        else URL.revokeObjectURL(url);
      } catch (e) {
        if (!cancelled)
          setPngErr(e instanceof Error ? e.message : 'Screenshot failed to load');
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [bundle]);

  // Copy-URLs button
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(clipboardBlock(bundle));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — older browsers / non-secure contexts
    }
  }, [bundle]);

  if (!user || !hasMinRole(user.role, 'regional_manager')) {
    return (
      <p className="text-sm text-red-600">
        Access denied. Regional Manager or above required.
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading bundle…</p>;
  }
  if (error || !bundle) {
    return (
      <div className="space-y-3">
        <Link
          to="/qa-bundles"
          className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800"
        >
          <ArrowLeft className="h-4 w-4" /> All bundles
        </Link>
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? 'Bundle not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to="/qa-bundles"
        className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800"
      >
        <ArrowLeft className="h-4 w-4" /> All bundles
      </Link>

      <PageHeader
        icon={Camera}
        title={bundle.slug}
        description={`Captured ${new Date(bundle.capturedAt).toLocaleString()}`}
        action={
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy stem
              </>
            )}
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* PNG */}
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Screenshot</h2>
          </div>
          {pngErr ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {pngErr}
            </div>
          ) : bundle.urls.png ? (
            pngObjectUrl ? (
              <img
                src={pngObjectUrl}
                alt={`${bundle.slug} screenshot`}
                className="w-full rounded-md border border-gray-200"
              />
            ) : (
              <p className="text-xs text-gray-500">Loading screenshot…</p>
            )
          ) : (
            <p className="text-xs text-gray-500">
              No screenshot in this bundle.
            </p>
          )}
        </div>

        {/* Sidecar */}
        <div className="space-y-2">
          {sidecarErr && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {sidecarErr}
            </div>
          )}
          {sidecar && (
            <>
              <Section title="Context" defaultOpen>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-gray-500">URL</dt>
                  <dd className="break-all font-mono text-gray-800">
                    {sidecar.url ?? '—'}
                  </dd>
                  <dt className="text-gray-500">Viewport</dt>
                  <dd className="font-mono text-gray-800">
                    {sidecar.viewport
                      ? `${sidecar.viewport.width}×${sidecar.viewport.height} @ ${sidecar.viewport.dpr}x`
                      : '—'}
                  </dd>
                  <dt className="text-gray-500">User</dt>
                  <dd className="break-all font-mono text-gray-800">
                    {(sidecar.auth?.claims as { email?: string } | undefined)?.email ??
                      (sidecar.auth?.claims as { sub?: string } | undefined)?.sub ??
                      '—'}
                  </dd>
                </dl>
              </Section>

              <Section title="Auth claims">
                <PreJson value={sidecar.auth?.claims ?? null} />
              </Section>

              <Section title="Feature flags">
                <PreJson value={sidecar.flags ?? {}} />
              </Section>

              <Section title="Storage">
                <PreJson value={sidecar.storage ?? {}} />
              </Section>

              <Section
                title={`Fetch log (${sidecar.qaBuffer?.fetch?.length ?? 0})`}
                defaultOpen
              >
                <FetchTable rows={sidecar.qaBuffer?.fetch ?? []} />
              </Section>

              <Section title={`Errors (${sidecar.qaBuffer?.errors?.length ?? 0})`}>
                <ErrorsList rows={sidecar.qaBuffer?.errors ?? []} />
              </Section>

              <Section title="Raw sidecar JSON">
                <PreJson value={sidecar} />
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Replay */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Session replay</h2>
        {bundle.urls.replay ? (
          <ReplayPanel stem={bundle.stem} />
        ) : (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            No replay in this bundle — rrweb wasn't initialised at capture
            time (e.g. unauthenticated page), or the upload failed.
          </div>
        )}
      </div>
    </div>
  );
}
