// Lazy-loaded rrweb session-replay buffer for the QA debug bundle.
// Mirrors qaBuffer.ts's module-level-singleton shape.
//
// Privacy — rrweb captures DOM mutations including form input values. Defaults:
//   maskAllInputs: true            — every <input>/<textarea>/<select> value masked
//   class="rr-block"               — full subtree excluded (auth widgets, payment iframes)
//   class="rr-mask"                — text content replaced with asterisks
//   [data-screenshot-exclude="1"]  — already honored by html-to-image; masked here too
//
// Memory — checkoutEveryNms rotates a two-bucket eventsMatrix; we trim to the
// last MAX_BUCKETS inside the emit callback so an N-hour QA session does not
// leak linearly.

export type QaReplayEvent = unknown;

const CHECKOUT_MS = 30_000;
const MAX_BUCKETS = 2;

let eventsMatrix: QaReplayEvent[][] = [[]];
let stopFn: (() => void) | undefined;
let installing: Promise<void> | null = null;

export async function installQaReplay(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (stopFn) return;
  if (installing) return installing;

  installing = (async () => {
    try {
      const mod = await import('@rrweb/record');
      if (stopFn) return;
      const handle = mod.record<QaReplayEvent>({
        emit(event, isCheckout) {
          if (isCheckout) {
            eventsMatrix.push([]);
            if (eventsMatrix.length > MAX_BUCKETS) {
              eventsMatrix = eventsMatrix.slice(-MAX_BUCKETS);
            }
          }
          eventsMatrix[eventsMatrix.length - 1].push(event);
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
    } catch {
      // best-effort; PNG + JSON sidecar continue without replay
    } finally {
      installing = null;
    }
  })();

  return installing;
}

export function getQaReplayEvents(): QaReplayEvent[] {
  return eventsMatrix.slice(-MAX_BUCKETS).flat();
}

export function clearQaReplay(): void {
  eventsMatrix = [[]];
}

export function stopQaReplay(): void {
  if (stopFn) {
    try { stopFn(); } catch { /* ignore */ }
    stopFn = undefined;
  }
}
