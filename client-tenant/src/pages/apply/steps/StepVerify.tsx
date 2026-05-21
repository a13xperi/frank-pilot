import { useEffect } from 'react';
import { Mail } from 'lucide-react';
import { api, getToken } from '@/api/client';
import { requestMagicLink } from '@/api/auth';
import { useApply } from '../ApplyContext';
import { useTranslation } from '@/i18n';
import { CTA } from '@/components/primitives';

export function StepVerify() {
  const s = useApply();
  const { t } = useTranslation('apply');

  // Verify-stage poll — preserved verbatim from legacy Apply.tsx semantics.
  // Only polls once a token has been stored (post magic-link verify), else
  // /auth/me 401 would eject the user to /login.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await api.get<{ user?: { email: string; emailVerified: boolean } }>('/auth/me');
        if (cancelled) return;
        if (res.user?.emailVerified) s.setStep('intent');
      } catch {
        /* 401 handled by client.ts */
      }
    }
    check();
    const interval = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [s]);

  async function handleResend() {
    if (!s.email) return;
    s.setResending(true);
    s.setError(null);
    try {
      await requestMagicLink(s.email);
      s.setResent(true);
    } catch (err) {
      s.setError(err instanceof Error ? err.message : t('verify.resendError'));
    } finally {
      s.setResending(false);
    }
  }

  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
        <Mail className="h-6 w-6 text-emerald-700" />
      </div>
      <h1 className="text-xl font-bold text-gray-900">{t('verify.title')}</h1>
      <p className="text-sm text-gray-500">
        {t('verify.body').replace('{email}', s.email)}
      </p>
      {s.resent && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          {t('verify.resent')}
        </div>
      )}
      <CTA onClick={handleResend} disabled={s.resending || !s.email}>
        {s.resending ? t('verify.resending') : t('verify.resend')}
      </CTA>
      {s.devLink && (
        <a
          href={s.devLink}
          className="block rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-800 hover:bg-amber-100"
        >
          {t('verify.devLink')}
        </a>
      )}
      <button
        onClick={() => s.setStep(1)}
        className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
      >
        {t('verify.useDifferent')}
      </button>
    </div>
  );
}
