import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, CheckCircle } from 'lucide-react';
import { api, clearToken } from '@/api/client';
import { requestMagicLink } from '@/api/auth';

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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600">
          <Mail className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Check your email</h1>
          <p className="mt-2 text-sm text-gray-500">
            We sent a verification link to{' '}
            <span className="font-medium text-gray-900">{email || 'your inbox'}</span>.
            Click it to continue your application.
          </p>
        </div>

        {resent && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle className="h-4 w-4" />
            Link resent
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={handleResend}
          disabled={resending || !email}
          className="btn-primary w-full"
        >
          {resending ? 'Resending…' : 'Resend link'}
        </button>

        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
