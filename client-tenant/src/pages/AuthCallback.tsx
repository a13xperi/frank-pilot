import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/api/client';
import { verifyMagicLink } from '@/api/auth';
import { Loader2 } from 'lucide-react';

interface MeResponse {
  user?: { role: string; emailVerified: boolean };
}

interface ApplicationsResponse {
  applications?: Array<{ id: string }>;
}

// First-touch friction killer: a freshly-verified applicant with no submitted
// application gets sent straight to /apply step 2 to finish in one sitting.
// Anyone else (returning applicant, staff) lands on /dashboard.
async function resolvePostVerifyRoute(): Promise<string> {
  try {
    const me = await api.get<MeResponse>('/auth/me');
    const role = me.user?.role;
    if (role !== 'applicant' && role !== 'tenant') return '/dashboard';
    const apps = await api.get<ApplicationsResponse>('/applicants/me/applications');
    if (!apps.applications || apps.applications.length === 0) return '/apply?step=2';
    return '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('No token found in link.');
      return;
    }

    verifyMagicLink(token)
      .then(resolvePostVerifyRoute)
      .then(dest => navigate(dest, { replace: true }))
      .catch(err => setError(err instanceof Error ? err.message : 'Invalid or expired link'));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="rounded-lg bg-red-50 p-4">
            <p className="font-medium text-red-800">Invalid or expired link</p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
          </div>
          <Link to="/login" className="text-sm font-medium text-emerald-600 hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
