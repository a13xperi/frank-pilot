/**
 * Wedge #10 — tenant Settings page.
 *
 * Tenants and applicants don't have passwords (they authenticate via magic
 * link), so the "password reset" surface is a one-tap "email me a fresh
 * sign-in link" affordance scoped to the JWT subject. The server endpoint
 * (`POST /users/me/password-reset-email`) takes no body and replies 204 — the
 * link is delivered out-of-band via email.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Mail } from 'lucide-react';
import { requestPasswordResetEmail } from '@/api/auth';
import { api } from '@/api/client';
import { HF } from '@/styles/tokens';
import { Card, CTA } from '@/components/primitives';

interface MeResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  } | null;
}

export function Settings() {
  const { t } = useTranslation('settings');
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the authenticated user's email so we can echo it in the success
  // toast. /auth/me is the canonical probe — it returns the live AuthUser the
  // JWT was minted for.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<MeResponse>('/auth/me');
        if (!cancelled && res.user?.email) {
          setEmail(res.user.email);
        }
      } catch {
        // Non-fatal — the form still works without the echoed address.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordResetEmail();
      setSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/too many requests/i.test(msg)) {
        setError(t('passwordReset.errors.rateLimited'));
      } else {
        setError(t('passwordReset.errors.generic'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-2xl px-4 py-8"
      style={{ fontFamily: HF.body, color: HF.ink }}
    >
      <header className="mb-6">
        <h1
          style={{
            fontFamily: HF.display,
            fontSize: 28,
            fontWeight: 800,
            color: HF.ink,
          }}
        >
          {t('page.title')}
        </h1>
        <p style={{ fontSize: 14, color: HF.ink3, marginTop: 4 }}>
          {t('page.subtitle')}
        </p>
      </header>

      <div className="space-y-4">
        <Card padding={20}>
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: HF.r.md,
                background: HF.sageLo,
                display: 'grid',
                placeItems: 'center',
                color: HF.sage,
              }}
            >
              <Mail className="h-4 w-4" />
            </div>
            <h2
              style={{
                fontFamily: HF.display,
                fontSize: 16,
                fontWeight: 700,
                margin: 0,
              }}
            >
              {t('account.heading')}
            </h2>
          </div>
          <div style={{ marginTop: 16 }}>
            <span
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 1,
                fontWeight: 700,
                color: HF.ink3,
                display: 'block',
              }}
            >
              {t('account.emailLabel')}
            </span>
            <div
              data-testid="settings-email"
              style={{
                marginTop: 4,
                fontSize: 15,
                color: HF.ink,
                fontWeight: 600,
              }}
            >
              {email || '—'}
            </div>
            <p style={{ marginTop: 8, fontSize: 13, color: HF.ink3 }}>
              {t('account.emailHint')}
            </p>
          </div>
        </Card>

        <Card padding={20}>
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: HF.r.md,
                background: HF.accentLo,
                display: 'grid',
                placeItems: 'center',
                color: HF.accent,
              }}
            >
              <KeyRound className="h-4 w-4" />
            </div>
            <h2
              style={{
                fontFamily: HF.display,
                fontSize: 16,
                fontWeight: 700,
                margin: 0,
              }}
            >
              {t('passwordReset.heading')}
            </h2>
          </div>
          <p style={{ marginTop: 12, fontSize: 14, color: HF.ink2 }}>
            {t('passwordReset.body')}
          </p>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 12,
                background: HF.errLo,
                border: `1px solid ${HF.err}`,
                color: HF.err,
                borderRadius: HF.r.sm,
                padding: '10px 12px',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {sent ? (
            <div
              role="status"
              style={{
                marginTop: 16,
                background: HF.sageLo,
                border: `1px solid ${HF.sage}33`,
                borderRadius: HF.r.md,
                padding: 14,
              }}
            >
              <p
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  fontSize: 14,
                  color: HF.ink,
                  margin: 0,
                }}
              >
                {t('passwordReset.sent', { email: email || 'your inbox' })}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
              <CTA
                type="submit"
                tone="primary"
                size="md"
                disabled={loading}
                aria-label={t('passwordReset.cta')}
              >
                {loading ? t('passwordReset.sending') : t('passwordReset.cta')}
              </CTA>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

export default Settings;
