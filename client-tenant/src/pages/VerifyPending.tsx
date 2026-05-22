import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, CheckCircle } from 'lucide-react';
import { api, clearToken } from '@/api/client';
import { requestMagicLink } from '@/api/auth';
import { HF } from '@/styles/tokens';
import { CTA } from '@/components/primitives';

interface MeResponse {
  user?: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
}

export function VerifyPending() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll /auth/me every 5s. As soon as the server reports emailVerified=true
  // (i.e. the user clicked the magic link in another tab), continue to the
  // application form.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const res = await api.get<MeResponse>('/auth/me');
        if (cancelled) return;
        if (res.user) {
          setEmail(res.user.email);
          if (res.user.emailVerified) {
            if (interval) clearInterval(interval);
            navigate('/apply?step=2');
          }
        }
      } catch {
        // 401 means token is gone — let client.ts redirect handle it.
      }
    }

    check();
    interval = setInterval(check, 5000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [navigate]);

  async function handleResend() {
    if (!email) return;
    setResending(true);
    setError(null);
    try {
      await requestMagicLink(email);
      setResent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend link');
    } finally {
      setResending(false);
    }
  }

  function handleSignOut() {
    clearToken();
    navigate('/login');
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      <div className="w-full max-w-sm space-y-6 text-center">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center"
          style={{ background: HF.accent, borderRadius: HF.r.md }}
        >
          <Mail className="h-6 w-6" style={{ color: HF.paper }} />
        </div>
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: HF.ink, fontFamily: HF.display }}
          >
            Check your email
          </h1>
          <p className="mt-2 text-sm" style={{ color: HF.ink3 }}>
            We sent a verification link to{' '}
            <span className="font-medium" style={{ color: HF.ink }}>
              {email || 'your inbox'}
            </span>
            . Click it to continue your application.
          </p>
        </div>

        {resent && (
          <div
            className="flex items-center justify-center gap-2 p-3 text-sm"
            style={{ background: HF.sageLo, color: HF.sage, borderRadius: HF.r.md }}
          >
            <CheckCircle className="h-4 w-4" />
            Link resent
          </div>
        )}
        {error && (
          <div
            className="p-3 text-sm"
            style={{ background: HF.errLo, color: HF.err, borderRadius: HF.r.md }}
          >
            {error}
          </div>
        )}

        <CTA
          tone="primary"
          block
          onClick={handleResend}
          disabled={resending || !email}
        >
          {resending ? 'Resending…' : 'Resend link'}
        </CTA>

        <button
          onClick={handleSignOut}
          className="text-sm underline"
          style={{ color: HF.ink3 }}
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
