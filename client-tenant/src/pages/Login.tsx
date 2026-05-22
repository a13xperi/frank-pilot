import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import { requestMagicLink } from '@/api/auth';
import { HF } from '@/styles/tokens';
import { CTA, Card } from '@/components/primitives';
import { TurnstileWidget } from '@/components/TurnstileWidget';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // wedge #13: bot-gate the magic-link request. In dev / smoke the widget
  // bypasses to `test-token-dev`; in prod a real Cloudflare challenge fires.
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = (await requestMagicLink(email, turnstileToken || undefined)) as {
        devLink?: string;
      };
      setSent(true);
      if (res.devLink) {
        setDevLink(res.devLink);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleDevLink() {
    if (!devLink) return;
    try {
      const url = new URL(devLink);
      navigate(`/auth/callback${url.search}`);
    } catch {
      navigate(`/auth/callback?token=${devLink}`);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: HF.cream, fontFamily: HF.body, color: HF.ink }}
    >
      <Card variant="mobile" padding={24} style={{ width: '100%', maxWidth: 380 }}>
        <div className="text-center">
          <div
            style={{
              margin: '0 auto 16px',
              width: 56,
              height: 56,
              borderRadius: HF.r.lg,
              background: HF.accent,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Mail className="h-6 w-6" style={{ color: HF.paper }} />
          </div>
          <h1 style={{ fontFamily: HF.display, fontSize: 24, fontWeight: 800 }}>
            Tenant Portal
          </h1>
          <p style={{ fontSize: 13, color: HF.ink3, marginTop: 4 }}>
            Sign in with a magic link
          </p>
        </div>

        {error && (
          <div
            style={{
              marginTop: 20,
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

        {!sent ? (
          <form onSubmit={handleSubmit} className="space-y-4" style={{ marginTop: 20 }}>
            <label className="flex flex-col gap-1" htmlFor="email">
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  fontWeight: 700,
                  color: HF.ink3,
                }}
              >
                Email address
              </span>
              <input
                id="email"
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  background: HF.paper,
                  border: `1px solid ${HF.border}`,
                  borderRadius: HF.r.sm,
                  padding: '10px 12px',
                  fontSize: 14,
                  color: HF.ink,
                  fontFamily: HF.body,
                }}
              />
            </label>
            <TurnstileWidget onVerify={setTurnstileToken} />
            <CTA type="submit" tone="primary" size="lg" disabled={loading || !email} block>
              {loading ? 'Sending…' : 'Send magic link'}
            </CTA>
          </form>
        ) : (
          <div className="space-y-4 text-center" style={{ marginTop: 20 }}>
            <div
              style={{
                background: HF.sageLo,
                border: `1px solid ${HF.sage}33`,
                borderRadius: HF.r.md,
                padding: 14,
              }}
            >
              <p style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 14, color: HF.ink }}>
                Check your email
              </p>
              <p style={{ fontSize: 13, color: HF.ink2, marginTop: 4 }}>
                We sent a link to <strong>{email}</strong>. Click it to sign in.
              </p>
            </div>
            {devLink && (
              <CTA onClick={handleDevLink} tone="sage">
                Continue (dev) <ArrowRight className="h-4 w-4" />
              </CTA>
            )}
          </div>
        )}

        <p
          style={{
            textAlign: 'center',
            marginTop: 24,
            fontSize: 13,
            color: HF.ink3,
          }}
        >
          First time?{' '}
          <Link to="/apply" style={{ color: HF.accent, fontWeight: 700, textDecoration: 'none' }}>
            Create an applicant account
          </Link>
        </p>
      </Card>
    </div>
  );
}
