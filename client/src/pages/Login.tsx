import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Database } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/api/client';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoResult, setDemoResult] = useState('');

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
    setDemoResult('');
    setError('');
    try {
      // Login as admin to seed
      await login('admin@cdpc.test', 'password123');
      const res = await api.post<{ created: number }>('/api/demo/seed');
      setDemoResult(`Demo loaded! ${res.created} applications across all stages.`);
      // Logout so user can pick a role to explore
      localStorage.removeItem('frank_token');
      localStorage.removeItem('frank_user');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo data');
    } finally {
      setDemoLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm space-y-4">
        <div className="rounded-xl bg-white p-8 shadow-lg">
          <div className="mb-6 flex flex-col items-center gap-2">
            <Building2 className="h-10 w-10 text-emerald-600" />
            <h1 className="text-xl font-semibold text-gray-900">CDPC Compliance Hub</h1>
            <p className="text-sm text-gray-500">Affordable Housing — Tenant Onboarding</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="you@cdpc.test"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="Enter password"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Demo toggle */}
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Demo Mode</p>
              <p className="text-xs text-gray-400">Load sample applications at every pipeline stage</p>
            </div>
            <button
              onClick={loadDemo}
              disabled={demoLoading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <Database className="h-4 w-4" />
              {demoLoading ? 'Loading...' : 'Load Demo'}
            </button>
          </div>
          {demoResult && (
            <p className="mt-2 rounded bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{demoResult}</p>
          )}
          <div className="mt-3 space-y-1">
            <p className="text-xs text-gray-400">Demo accounts (password: password123):</p>
            <div className="grid grid-cols-2 gap-x-4 text-xs text-gray-500">
              <span>agent@cdpc.test</span><span>Leasing Agent</span>
              <span>senior@cdpc.test</span><span>Senior Manager</span>
              <span>regional@cdpc.test</span><span>Regional Manager</span>
              <span>asset@cdpc.test</span><span>Asset Manager</span>
              <span>admin@cdpc.test</span><span>System Admin</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
