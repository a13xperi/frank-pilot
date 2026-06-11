/**
 * TalkToFrankPill — "Talk to Frank" voice-call entry point.
 *
 * Floating pill (top-right) that mints a signed URL from POST /api/voice/sessions
 * and hands it to the ElevenLabs Conversational AI WebRTC SDK. Visible on every
 * route via App.tsx as a sibling to <Routes/>.
 *
 * Lifecycle:
 *   idle → user click → starting (mint) → connecting (mic + WebRTC handshake)
 *                                       → live → user click → idle
 *
 * Hide-forever signals (the pill renders null and never reappears in this page
 * lifetime):
 *   - First mint returns 503 (feature flag off OR daily budget exhausted).
 *   - Cookie-consent banner is showing (same yield as HousingChatWidget — the
 *     bottom-banner Reject / Customize buttons need an uncluttered viewport).
 *
 * Transient signals (returns to idle after ~5s):
 *   - 429 rate-limited → hint
 *   - 502 / network error → hint
 *   - mic permission denied → hint
 *
 * No telemetry, no PII. The backend's `frank_voice_session` cookie is set by
 * the API; we never touch it client-side.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Conversation } from '@elevenlabs/client';
import { HF } from '@/styles/tokens';
import { startVoiceSession, type StartVoiceSessionResult } from '@/api/client';
import { useConsent } from '@/state/consent';

type PillState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

// Indirection for tests: jest/vitest swaps these so the SDK + fetch never run.
type VoiceDriver = {
  mint: () => Promise<StartVoiceSessionResult>;
  startSession: (signedUrl: string, callbacks: ConvCallbacks) => Promise<{ endSession: () => Promise<void> }>;
};
type ConvCallbacks = {
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (err: unknown) => void;
};

let driver: VoiceDriver = {
  mint: () => startVoiceSession(),
  startSession: async (signedUrl, callbacks) => {
    // @elevenlabs/client returns a conversation object with .endSession().
    // The SDK requests mic permission internally; if the user denies it the
    // promise rejects and we surface 'error' in the catch below.
    const conv = await Conversation.startSession({
      signedUrl,
      onConnect: callbacks.onConnect,
      onDisconnect: callbacks.onDisconnect,
      onError: callbacks.onError,
    });
    return conv;
  },
};

export function __setVoiceDriverForTests(d: VoiceDriver | null): void {
  driver = d ?? {
    mint: () => startVoiceSession(),
    startSession: async (signedUrl, callbacks) => {
      const conv = await Conversation.startSession({
        signedUrl,
        onConnect: callbacks.onConnect,
        onDisconnect: callbacks.onDisconnect,
        onError: callbacks.onError,
      });
      return conv;
    },
  };
}

export function TalkToFrankPill() {
  // KILL SWITCH (Jun 11 demo): same scope leak as HousingChatWidget — the
  // assistant surface can answer from the statewide HUD-LIHTC dataset and leak
  // internal names. Re-enable via VITE_ENABLE_FAQ_CHAT=true after the
  // fix/housing-qa-tenant-scope PR lands on main.
  if (import.meta.env.VITE_ENABLE_FAQ_CHAT !== 'true' && import.meta.env.MODE !== 'test') return null;
  const { t } = useTranslation('voice');
  const { needsChoice } = useConsent();
  const [state, setState] = useState<PillState>({ kind: 'idle' });
  // Once we get a 503, hide forever. Stored in a ref so cookie-banner dismissal
  // doesn't bring the pill back from the dead.
  const [hiddenForever, setHiddenForever] = useState(false);
  const conversationRef = useRef<{ endSession: () => Promise<void> } | null>(null);
  const transientTimerRef = useRef<number | null>(null);

  // Auto-dismiss rate-limit / error hints back to idle after 5s.
  useEffect(() => {
    if (state.kind !== 'rate_limited' && state.kind !== 'error') return;
    transientTimerRef.current = window.setTimeout(() => {
      setState({ kind: 'idle' });
    }, 5000);
    return () => {
      if (transientTimerRef.current) {
        window.clearTimeout(transientTimerRef.current);
        transientTimerRef.current = null;
      }
    };
  }, [state.kind]);

  // Clean up an in-flight conversation if the component unmounts mid-call.
  useEffect(() => {
    return () => {
      conversationRef.current?.endSession().catch(() => {
        /* best-effort */
      });
      conversationRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (state.kind !== 'idle' && state.kind !== 'rate_limited' && state.kind !== 'error') return;
    setState({ kind: 'starting' });
    const result = await driver.mint();
    if (result.status === 'disabled') {
      setHiddenForever(true);
      return;
    }
    if (result.status === 'rate_limited') {
      setState({ kind: 'rate_limited' });
      return;
    }
    if (result.status === 'error') {
      setState({ kind: 'error' });
      return;
    }
    setState({ kind: 'connecting' });
    try {
      const conv = await driver.startSession(result.signedUrl, {
        onConnect: () => setState({ kind: 'live' }),
        onDisconnect: () => {
          conversationRef.current = null;
          setState({ kind: 'idle' });
        },
        onError: () => {
          conversationRef.current = null;
          setState({ kind: 'error' });
        },
      });
      conversationRef.current = conv;
    } catch {
      // Mic-permission denial or WebRTC handshake failure lands here.
      conversationRef.current = null;
      setState({ kind: 'error' });
    }
  }, [state.kind]);

  const stop = useCallback(async () => {
    const conv = conversationRef.current;
    conversationRef.current = null;
    if (conv) {
      try {
        await conv.endSession();
      } catch {
        /* best-effort */
      }
    }
    setState({ kind: 'idle' });
  }, []);

  const onClick = useCallback(() => {
    if (state.kind === 'live') {
      void stop();
    } else {
      void start();
    }
  }, [state.kind, start, stop]);

  if (hiddenForever) return null;
  if (needsChoice) return null;

  const isLive = state.kind === 'live';
  const isBusy = state.kind === 'starting' || state.kind === 'connecting';
  const isHint = state.kind === 'rate_limited' || state.kind === 'error';

  const label =
    state.kind === 'live'
      ? t('pill.live')
      : state.kind === 'connecting' || state.kind === 'starting'
        ? t('pill.connecting')
        : t('pill.idle');

  const ariaLabel = isLive ? t('pill.label.live') : t('pill.label.idle');

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
        fontFamily: HF.body,
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isLive}
        onClick={onClick}
        disabled={isBusy}
        data-state={state.kind}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px 8px 12px',
          borderRadius: HF.r.pill,
          border: `1px solid ${isLive ? HF.err : HF.accent}`,
          background: isLive ? HF.err : HF.accent,
          color: HF.paper,
          fontSize: 13,
          fontWeight: 600,
          fontFamily: HF.body,
          cursor: isBusy ? 'progress' : 'pointer',
          boxShadow: HF.shadow.md,
          opacity: isBusy ? 0.85 : 1,
          transition: 'background 120ms ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          {isLive ? (
            <path
              d="M6 6l12 12M6 18L18 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M5.5 4.5a2 2 0 0 1 2-1.5h2.2a1 1 0 0 1 1 .8l.6 3a1 1 0 0 1-.3 1L9.6 9a13 13 0 0 0 5.4 5.4l1.2-1.4a1 1 0 0 1 1-.3l3 .6a1 1 0 0 1 .8 1V16.5a2 2 0 0 1-1.5 2C12.5 19.5 4.5 11.5 5.5 4.5z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        <span>{label}</span>
        {isLive && (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: HF.paper,
              boxShadow: '0 0 0 0 rgba(255,255,255,0.85)',
              animation: 'frank-pulse 1.5s ease-out infinite',
            }}
          />
        )}
      </button>
      {isHint && (
        <div
          role="status"
          style={{
            background: HF.paper,
            color: HF.ink2,
            border: `1px solid ${HF.border}`,
            borderRadius: HF.r.md,
            padding: '6px 10px',
            fontSize: 12,
            maxWidth: 240,
            boxShadow: HF.shadow.sm,
          }}
        >
          {state.kind === 'rate_limited' ? t('hint.rateLimited') : t('hint.error')}
        </div>
      )}
      <style>{`
        @keyframes frank-pulse {
          0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.85); }
          70% { box-shadow: 0 0 0 8px rgba(255,255,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
      `}</style>
    </div>
  );
}

export default TalkToFrankPill;
