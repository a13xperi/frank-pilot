import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n';
import { fetchWaitlistSummary, type WaitlistSummary } from '@/api/properties';
import { Pill } from '@/components/primitives';

interface Props {
  slug: string;
}

export function WaitlistBanner({ slug }: Props) {
  const { t } = useTranslation('discover');
  const [summary, setSummary] = useState<WaitlistSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchWaitlistSummary(slug)
      .then((s) => {
        if (alive) setSummary(s);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        role="status"
        aria-live="polite"
      >
        {t('waitlist.loading')}
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
      role="status"
      aria-live="polite"
      data-testid="waitlist-banner"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="warn">● {t('waitlist.title')}</Pill>
        <span className="text-sm font-semibold text-amber-900">
          {t('waitlist.position', { position: summary.position })}
        </span>
        <span className="text-sm text-amber-900/80">
          · {t('waitlist.estimate', { window: summary.expectedNotificationWindow })}
        </span>
      </div>
    </div>
  );
}
