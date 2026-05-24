// Full-session capture for usability/demo walkthroughs.
//
// Distinct from qaSessionReplay.ts (a rolling 60s ring buffer feeding the
// camera button): when a tester arrives via `?demo=<TOKEN>` we record the
// ENTIRE session and stream it to Supabase, keyed by the per-tab runId, so a
// reviewer can replay the whole funnel and see exactly where people stall.
//
// Layout under the shared QA bucket:
//   demo/{runId}/replay-000.json, replay-001.json, …   rrweb event segments
//   demo/{runId}/events.json                            funnel + "stuck" events
//   demo/{runId}/manifest.json                          index written on exit
//
// rrweb checkpoints every CHECKOUT_MS (each checkout emits a fresh full
// snapshot), so each segment is self-contained and the viewer can concatenate
// them in order. Privacy config mirrors qaSessionReplay (maskAllInputs:true,
// rr-block / rr-mask / [data-pii]) — never relax it; testers type real PII.

import { isDemoMode, getRunId } from './demoSession';
import { uploadToSupabase, qaUploadConfigured } from './qaUpload';

const CHECKOUT_MS = 15_000;

type RRWebEvent = unknown;

export interface DemoEvent {
  type: string;
  ts: number;
  route: string;
  // step/note/etc. — caller-supplied context, kept loose on purpose.
  [k: string]: unknown;
}

let started = false;
let stopFn: (() => void) | undefined;
let runId: string | null = null;

// Current (unsealed) rrweb segment + the next segment index to write.
let segment: RRWebEvent[] = [];
let segSeq = 0;
let segmentsWritten = 0;

// Funnel/interaction events, flushed (debounced) as a single JSON array.
const events: DemoEvent[] = [];
let eventsFlushTimer: ReturnType<typeof setTimeout> | undefined;

let startedAt = 0;

function seg3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Seal the current segment and upload it as replay-{seq}.json. */
function flushSegment(opts: { keepalive?: boolean } = {}): void {
  if (!runId || segment.length === 0) return;
  const batch = segment;
  const seq = segSeq;
  segment = [];
  segSeq += 1;
  segmentsWritten += 1;
  void uploadToSupabase(
    JSON.stringify(batch),
    `demo/${runId}/replay-${seg3(seq)}.json`,
    'application/json',
    opts,
  ).catch(() => {
    /* best-effort — a dropped segment shouldn't break the walkthrough */
  });
}

function flushEvents(opts: { keepalive?: boolean } = {}): void {
  if (!runId || events.length === 0) return;
  void uploadToSupabase(
    JSON.stringify(events),
    `demo/${runId}/events.json`,
    'application/json',
    opts,
  ).catch(() => {
    /* best-effort */
  });
}

function writeManifest(opts: { keepalive?: boolean } = {}): void {
  if (!runId) return;
  const manifest = {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    replaySegments: segmentsWritten,
    eventsCount: events.length,
    finalRoute: typeof window !== 'undefined' ? window.location.pathname : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    language: typeof navigator !== 'undefined' ? navigator.language : null,
  };
  void uploadToSupabase(
    JSON.stringify(manifest, null, 2),
    `demo/${runId}/manifest.json`,
    'application/json',
    opts,
  ).catch(() => {
    /* best-effort */
  });
}

/**
 * Append a funnel/interaction event (step-entered, stuck, …). Route + ts are
 * stamped automatically. No-op outside a demo session.
 */
export function logDemoEvent(type: string, data: Record<string, unknown> = {}): void {
  if (!isDemoMode()) return;
  events.push({
    type,
    ts: Date.now(),
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    ...data,
  });
  // Debounce: coalesce rapid events, but land them within a couple seconds in
  // case the tester closes the tab before pagehide fires reliably.
  if (eventsFlushTimer) clearTimeout(eventsFlushTimer);
  eventsFlushTimer = setTimeout(() => flushEvents(), 2_000);
}

/**
 * Start full-session capture. No-op unless this tab is a demo session and the
 * Supabase storage env is configured. Idempotent.
 */
export async function startDemoCapture(): Promise<void> {
  if (started || typeof window === 'undefined') return;
  if (!isDemoMode() || !qaUploadConfigured()) return;
  runId = getRunId();
  if (!runId) return;
  started = true;
  startedAt = Date.now();

  // Flush on the way out — keepalive lets these land during unload.
  const onExit = () => {
    flushSegment({ keepalive: true });
    flushEvents({ keepalive: true });
    writeManifest({ keepalive: true });
  };
  window.addEventListener('pagehide', onExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onExit();
  });

  try {
    const mod = await import('@rrweb/record');
    if (!started) return;
    const handle = mod.record<RRWebEvent>({
      emit(event, isCheckout) {
        if (isCheckout && segment.length > 0) {
          // A new full snapshot is starting — seal the prior segment first.
          flushSegment();
        }
        segment.push(event);
      },
      checkoutEveryNms: CHECKOUT_MS,
      maskAllInputs: true,
      maskTextClass: 'rr-mask',
      blockClass: 'rr-block',
      maskTextSelector: '[data-screenshot-exclude="1"], [data-pii]',
      recordCanvas: false,
      collectFonts: false,
    });
    stopFn = handle ?? undefined;
    logDemoEvent('session-start');
  } catch {
    // rrweb failed to load — events.json still captures the funnel.
  }
}

export function stopDemoCapture(): void {
  if (stopFn) {
    try { stopFn(); } catch { /* ignore */ }
    stopFn = undefined;
  }
  flushSegment();
  flushEvents();
  writeManifest();
  started = false;
}
