import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, ArrowRight } from 'lucide-react';
import { requestMagicLink } from '@/api/auth';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await requestMagicLink(email) as any;
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600">
            <Mail className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Portal</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in with a magic link</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {!sent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                required
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email}
              className="btn-primary w-full"
            >
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-emerald-50 p-4">
              <p className="font-medium text-emerald-800">Check your email!</p>
              <p className="mt-1 text-sm text-emerald-700">
                We sent a link to <strong>{email}</strong>. Click it to sign in.
              </p>
            </div>
            {devLink && (
              <button
                onClick={handleDevLink}
                className="btn-primary inline-flex items-center gap-2"
              >
                Continue (dev) <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          First time?{' '}
          <Link to="/apply" className="font-medium text-emerald-600 hover:underline">
            Create an applicant account
          </Link>
        </p>
      </div>
    </div>
  );
}
