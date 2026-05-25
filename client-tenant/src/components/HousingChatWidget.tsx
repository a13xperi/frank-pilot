/**
 * HousingChatWidget — Intercom-style floating chat for grounded housing Q&A.
 *
 * A floating bubble (bottom-right) expands into a chat panel. Mostly seen by
 * pre-registration visitors asking about NV affordable-housing properties and
 * the application process. Backed by the public, grounded POST /api/housing-qa
 * endpoint (non-streaming) via askHousingQa().
 *
 * Styling uses the repo's shared brand tokens (HF) + the CTA primitive — no new
 * styling system. Accessible: focus management on open, Esc to close, aria
 * labels, scrollable history, "typing…" indicator, and an error state.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { CTA } from '@/components/primitives/CTA';
import { askHousingQa } from '@/api/client';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

let _seq = 0;
const nextId = () => `m${Date.now()}-${_seq++}`;

export function HousingChatWidget() {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);

  // Focus the input when the panel opens; return focus to the bubble on close.
  useEffect(() => {
    if (open) {
      // defer so the element is mounted
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    bubbleRef.current?.focus();
  }, [open]);

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-scroll history to the latest message.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || loading) return;
    setError(false);
    setInput('');
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text: question };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const { answer } = await askHousingQa(question);
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: answer },
      ]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ── Bubble (collapsed) ──────────────────────────────────────────────
  if (!open) {
    return (
      <button
        ref={bubbleRef}
        type="button"
        aria-label={t('bubble.label')}
        title={t('bubble.label')}
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          right: 20,
          bottom: 20,
          zIndex: 1000,
          width: 56,
          height: 56,
          borderRadius: HF.r.pill,
          background: HF.accent,
          color: HF.paper,
          border: 'none',
          boxShadow: HF.shadow.lg,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: HF.body,
        }}
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4H6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  // ── Panel (expanded) ────────────────────────────────────────────────
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={t('panel.title')}
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1000,
        width: 'min(380px, calc(100vw - 32px))',
        height: 'min(560px, calc(100vh - 40px))',
        display: 'flex',
        flexDirection: 'column',
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.lg,
        boxShadow: HF.shadow.lg,
        overflow: 'hidden',
        fontFamily: HF.body,
        color: HF.ink,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: HF.accent,
          color: HF.paper,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: HF.display,
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            {t('panel.title')}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.92, marginTop: 4, lineHeight: 1.35 }}>
            {t('panel.greeting')}
          </div>
        </div>
        <button
          type="button"
          aria-label={t('panel.close')}
          onClick={() => setOpen(false)}
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            color: HF.paper,
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ×
        </button>
      </div>

      {/* Message list */}
      <div
        aria-live="polite"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          background: HF.cream,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: HF.ink3, fontSize: 13, lineHeight: 1.45 }}>
            {t('empty.hint')}
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: HF.ink3,
                  marginBottom: 3,
                  textAlign: isUser ? 'right' : 'left',
                }}
              >
                {isUser ? t('message.you') : t('message.assistant')}
              </div>
              <div
                style={{
                  background: isUser ? HF.accent : HF.paper,
                  color: isUser ? HF.paper : HF.ink,
                  border: isUser ? 'none' : `1px solid ${HF.border}`,
                  borderRadius: HF.r.md,
                  padding: '8px 11px',
                  fontSize: 13.5,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  boxShadow: HF.shadow.xs,
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}

        {loading && (
          <div
            aria-label={t('status.typing')}
            style={{
              alignSelf: 'flex-start',
              background: HF.paper,
              border: `1px solid ${HF.border}`,
              borderRadius: HF.r.md,
              padding: '8px 11px',
              fontSize: 13,
              color: HF.ink3,
              fontStyle: 'italic',
            }}
          >
            {t('status.typing')}
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
              background: HF.errLo,
              color: HF.err,
              border: `1px solid ${HF.err}`,
              borderRadius: HF.r.md,
              padding: '8px 11px',
              fontSize: 13,
            }}
          >
            {t('error.generic')}{' '}
            <button
              type="button"
              onClick={() => void send()}
              style={{
                background: 'transparent',
                border: 'none',
                color: HF.err,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                font: 'inherit',
              }}
            >
              {t('error.retry')}
            </button>
          </div>
        )}

        <div ref={listEndRef} />
      </div>

      {/* Input row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 10,
          borderTop: `1px solid ${HF.border}`,
          background: HF.paper,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={t('input.placeholder')}
          aria-label={t('input.placeholder')}
          disabled={loading}
          style={{
            flex: 1,
            border: `1px solid ${HF.border}`,
            borderRadius: HF.r.sm,
            padding: '9px 11px',
            fontSize: 13.5,
            fontFamily: HF.body,
            color: HF.ink,
            background: HF.paperHi,
            outline: 'none',
          }}
        />
        <CTA
          tone="primary"
          size="md"
          onClick={() => void send()}
          disabled={loading || input.trim().length === 0}
          aria-label={t('input.sendLabel')}
        >
          {t('input.send')}
        </CTA>
      </div>
    </div>
  );
}

export default HousingChatWidget;
