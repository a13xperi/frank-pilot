import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Database } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/api/client';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadDemo() {
    setDemoLoading(true);
    try {
      // Login as admin to seed
      await login('admin@cdpc.test', 'password123');
      const res = await api.post<{ created: number }>('/api/demo/seed');
      toast.success(`Demo loaded! ${res.created} applications across all stages.`);
      // Logout so user can pick a role to explore
      localStorage.removeItem('frank_token');
      localStorage.removeItem('frank_user');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load demo data');
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-50 px-4">
      {/* Quiet emerald atmosphere at the top of the page — works in both themes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(70%_100%_at_50%_0%,rgb(16_185_129_/_0.08),transparent)]"
      />
      <div className="relative w-full max-w-sm space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-pop">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 shadow-btn-primary">
              <Building2 className="h-6 w-6 text-white" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-gray-900">
                CDPC Compliance Hub
              </h1>
              <p className="mt-1 text-13 text-gray-500">Affordable Housing — Tenant Onboarding</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@cdpc.test"
              />
            </div>
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Enter password"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-13 text-red-700 ring-1 ring-inset ring-red-200/60">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" loading={submitting} className="w-full">
              Sign In
            </Button>
          </form>
        </div>

        {/* Demo toggle */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-2xs font-semibold uppercase text-gray-500">Demo Mode</p>
              <p className="mt-0.5 text-xs text-gray-400">
                Load sample applications at every pipeline stage
              </p>
            </div>
            <Button
              onClick={loadDemo}
              variant="secondary"
              size="sm"
              loading={demoLoading}
              className="shrink-0 whitespace-nowrap"
            >
              <Database className="h-4 w-4" />
              Load Demo
            </Button>
          </div>
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400">
              Demo accounts <span className="text-gray-300">·</span> password:{' '}
              <code className="font-mono text-gray-500">password123</code>
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
              <span className="font-mono text-gray-500">agent@cdpc.test</span>
              <span className="text-gray-400">Leasing Agent</span>
              <span className="font-mono text-gray-500">senior@cdpc.test</span>
              <span className="text-gray-400">Senior Manager</span>
              <span className="font-mono text-gray-500">regional@cdpc.test</span>
              <span className="text-gray-400">Regional Manager</span>
              <span className="font-mono text-gray-500">asset@cdpc.test</span>
              <span className="text-gray-400">Asset Manager</span>
              <span className="font-mono text-gray-500">admin@cdpc.test</span>
              <span className="text-gray-400">System Admin</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
