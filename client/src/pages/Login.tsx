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
    <div className="ops-bg flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm space-y-3">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 bg-gray-100">
              <Building2 className="h-5 w-5 text-gray-700" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-gray-900">
                CDPC Compliance Hub
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
                Affordable Housing · Tenant Onboarding
              </p>
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
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" loading={submitting} className="w-full">
              Sign In
            </Button>
          </form>
        </div>

        {/* Demo toggle */}
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Demo Mode
              </p>
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
              <Database className="h-3.5 w-3.5" />
              Load Demo
            </Button>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-400">
              Demo accounts (password: <span className="font-mono">password123</span>):
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-500">
              <span className="font-mono text-[11px]">agent@cdpc.test</span><span>Leasing Agent</span>
              <span className="font-mono text-[11px]">senior@cdpc.test</span><span>Senior Manager</span>
              <span className="font-mono text-[11px]">regional@cdpc.test</span><span>Regional Manager</span>
              <span className="font-mono text-[11px]">asset@cdpc.test</span><span>Asset Manager</span>
              <span className="font-mono text-[11px]">admin@cdpc.test</span><span>System Admin</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
