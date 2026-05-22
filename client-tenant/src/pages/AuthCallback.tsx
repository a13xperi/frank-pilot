import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/api/client';
import { verifyMagicLink } from '@/api/auth';
import { Loader2 } from 'lucide-react';
import { HF } from '@/styles/tokens';

interface MeResponse {
  user?: { role: string; emailVerified: boolean };
}

interface MyAppsResponse {
  applications?: Array<{ status: string }>;
}

// Anything past draft means the user has already submitted — sending them
// back to the intent quiz would be the wrong screen entirely.
const SUBMITTED_STATUSES = new Set([
  'submitted',
  'screening',
  'screening_passed',
  'screening_failed',
  'tier1_review',
  'tier1_approved',
  'tier1_denied',
  'tier2_review',
  'tier2_approved',
  'tier2_denied',
  'tier3_review',
  'tier3_approved',
  'tier3_denied',
  'lease_generated',
  'onboarded',
]);

// Applicants/tenants land on the intent quiz first — it's the entry to the
// "plant a flag" flow that converts FTUs by getting them to claim a specific
// unit before the heavier details form. Step 'intent' redirects forward on its
// own if a claim already exists. Staff/admin go straight to /dashboard.
// Already-submitted/onboarded users skip the funnel entirely and land on the
// status page.
async function fetchMeWithRetry(): Promise<MeResponse> {
  try {
    return await api.get<MeResponse>('/auth/me');
  } catch {
    await new Promise(resolve => setTimeout(resolve, 500));
    return api.get<MeResponse>('/auth/me');
  }
}

async function resolvePostVerifyRoute(): Promise<string> {
  // Retry once on transient /auth/me failure. Defaulting to the intent quiz
  // here misroutes staff (and any returning applicant) into the wrong screen.
  // If both attempts fail, throw so the caller shows an error instead of
  // silently misrouting.
  const me = await fetchMeWithRetry();
  const role = me.user?.role;
  if (role !== 'applicant' && role !== 'tenant') return '/dashboard';
  try {
    const apps = await api.get<MyAppsResponse>('/applicants/me/applications');
    const hasSubmitted = apps.applications?.some((a) => SUBMITTED_STATUSES.has(a.status));
    if (hasSubmitted) return '/application';
  } catch {
    // Fall through to the intent quiz if status lookup fails.
  }
  return '/apply?step=intent';
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
      .then(async () => {
        try {
          return await resolvePostVerifyRoute();
        } catch {
          // Magic-link verify succeeded but /auth/me kept failing after retry.
          // Don't guess the role — route to /login so AuthGuard can re-check
          // once the user reloads with a working network.
          return '/login';
        }
      })
      .then(dest => navigate(dest, { replace: true }))
      .catch(err => setError(err instanceof Error ? err.message : 'Invalid or expired link'));
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4"
        style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
      >
        <div className="w-full max-w-sm space-y-4 text-center">
          <div
            className="p-4"
            style={{ background: HF.errLo, borderRadius: HF.r.md }}
          >
            <p className="font-medium" style={{ color: HF.err }}>
              Invalid or expired link
            </p>
            <p className="mt-1 text-sm" style={{ color: HF.err }}>
              {error}
            </p>
          </div>
          <Link
            to="/login"
            className="text-sm font-medium underline"
            style={{ color: HF.accent }}
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: HF.cream, color: HF.ink, fontFamily: HF.body }}
    >
      <div className="flex flex-col items-center gap-3" style={{ color: HF.ink3 }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: HF.accent }} />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
