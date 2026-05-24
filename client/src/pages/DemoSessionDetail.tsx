import { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Film, ArrowLeft, AlertTriangle, Flag } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/PageHeader';
import { hasMinRole } from '@/types';

interface DemoRunDetail {
  runId: string;
  segments: string[];
  events: string | null;
  manifest: string | null;
}

interface DemoRunResponse {
  run: DemoRunDetail;
}

interface DemoEvent {
  type: string;
  ts: number;
  route?: string;
  step?: string;
  note?: string | null;
  [k: string]: unknown;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('frank_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Concatenates the run's replay segments (each a full rrweb event array,
 * uploaded in order with a full-snapshot checkpoint at the head) into one
 * timeline and mounts rrweb-player over it.
 */
function ReplayPanel({
  runId,
  segments,
}: {
  runId: string;
  segments: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading replay…');

  useEffect(() => {
    if (!containerRef.current || segments.length === 0) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const [{ default: RrwebPlayer }] = await Promise.all([
          import('rrweb-player'),
          import('rrweb-player/dist/style.css'),
        ]);
        // Fetch every segment in parallel, then flatten in declared order.
        const parts = await Promise.all(
          segments.map((name) =>
            fetchJson<unknown[]>(
              `/api/qa/demo/${encodeURIComponent(runId)}/file/${encodeURIComponent(name)}`,
            ),
          ),
        );
        if (disposed || !containerRef.current) return;
        const events = parts.flat();
        if (!Array.isArray(events) || events.length < 2) {
          setErr('Replay is empty or malformed (rrweb needs ≥2 events).');
          return;
        }
        setStatus('');
        const instance = new (RrwebPlayer as unknown as new (opts: {
          target: HTMLElement;
          props: {
            events: unknown[];
            autoPlay: boolean;
            width?: number;
            height?: number;
          };
        }) => unknown)({
          target: containerRef.current,
          props: { events, autoPlay: false, width: 900, height: 540 },
        });
        cleanup = () => {
          if (containerRef.current) containerRef.current.innerHTML = '';
          void instance;
        };
      } catch (e) {
        if (!disposed)
          setErr(e instanceof Error ? e.message : 'Replay failed to load');
      }
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [runId, segments]);

  return (
    <div>
      {err && (
        <div className="mb-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}
      {!err && status && <p className="mb-2 text-xs text-gray-500">{status}</p>}
      <div ref={containerRef} className="rounded-lg border border-gray-200 bg-white p-2" />
    </div>
  );
}

function EventTimeline({
  runId,
  hasEvents,
}: {
  runId: string;
  hasEvents: boolean;
}) {
  const [events, setEvents] = useState<DemoEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!hasEvents) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchJson<DemoEvent[]>(
          `/api/qa/demo/${encodeURIComponent(runId)}/file/events.json`,
        );
        if (!cancelled) setEvents(Array.isArray(json) ? json : []);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : 'Events failed to load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, hasEvents]);

  if (err)
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {err}
      </div>
    );
  if (!events) return <p className="text-xs text-gray-500">Loading events…</p>;
  if (events.length === 0)
    return <p className="text-xs text-gray-500">No events recorded.</p>;

  const t0 = events[0]?.ts ?? 0;
  return (
    <ol className="space-y-1">
      {events.map((e, i) => {
        const rel = ((e.ts - t0) / 1000).toFixed(1);
        const isStuck = e.type === 'stuck';
        const isStep = e.type === 'step-entered';
        return (
          <li
            key={i}
            className={`flex items-start gap-2 rounded-md px-3 py-1.5 text-xs ${
              isStuck ? 'bg-red-50 text-red-800' : 'text-gray-700'
            }`}
          >
            <span className="w-12 shrink-0 font-mono text-gray-400">+{rel}s</span>
            {isStuck ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            ) : isStep ? (
              <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            ) : (
              <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="font-medium">
                {isStep ? `Step: ${e.step}` : e.type}
              </span>
              {e.note ? (
                <span className="ml-1 italic text-red-700">“{e.note}”</span>
              ) : null}
              {e.route ? (
                <span className="ml-1 font-mono text-gray-400">{e.route}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function DemoSessionDetail() {
  const { user } = useAuth();
  const { runId } = useParams<{ runId: string }>();
  const gated = !!user && hasMinRole(user.role, 'regional_manager');

  const { data, loading, error } = useApiQuery<DemoRunResponse>(
    gated && runId ? `/api/qa/demo/${encodeURIComponent(runId)}` : null,
  );
  const run = data?.run ?? null;

  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!run?.manifest || !runId) return;
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchJson<Record<string, unknown>>(
          `/api/qa/demo/${encodeURIComponent(runId)}/file/manifest.json`,
        );
        if (!cancelled) setManifest(json);
      } catch {
        /* manifest is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run, runId]);

  if (!user || !hasMinRole(user.role, 'regional_manager')) {
    return (
      <p className="text-sm text-red-600">
        Access denied. Regional Manager or above required.
      </p>
    );
  }

  if (loading) return <p className="text-sm text-gray-500">Loading demo session…</p>;
  if (error || !run) {
    return (
      <div className="space-y-3">
        <Link
          to="/qa-bundles"
          className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800"
        >
          <ArrowLeft className="h-4 w-4" /> All bundles
        </Link>
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error ?? 'Demo session not found.'}
        </div>
      </div>
    );
  }

  const stuckCount =
    manifest && typeof manifest.stuckCount === 'number'
      ? (manifest.stuckCount as number)
      : null;

  return (
    <div className="space-y-4">
      <Link
        to="/qa-bundles"
        className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:text-emerald-800"
      >
        <ArrowLeft className="h-4 w-4" /> All bundles
      </Link>

      <PageHeader
        icon={Film}
        title={run.runId}
        description={`${run.segments.length} replay segment(s)${
          stuckCount != null ? ` · ${stuckCount} stuck marker(s)` : ''
        }`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Session replay</h2>
          {run.segments.length > 0 ? (
            <ReplayPanel runId={run.runId} segments={run.segments} />
          ) : (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              No replay segments — capture didn't initialise or the upload failed.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="mb-2 text-sm font-medium text-gray-700">Funnel events</h2>
            <div className="max-h-[540px] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
              <EventTimeline runId={run.runId} hasEvents={!!run.events} />
            </div>
          </div>

          {manifest && (
            <div>
              <h2 className="mb-2 text-sm font-medium text-gray-700">Manifest</h2>
              <pre className="overflow-x-auto rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
