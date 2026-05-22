import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchWaitlistSummary, type WaitlistSummary } from '@/api/properties';
import { Pill } from '@/components/primitives';

interface Props {
  slug: string;
  // Wedge #5: position is per-bedroom-tier per property. Callers (PropertyDetail)
  // pass the tier they're showing; default 2BR matches the most common request.
  bedrooms?: number;
}

export function WaitlistBanner({ slug, bedrooms = 2 }: Props) {
  const { t } = useTranslation('discover');
  const [summary, setSummary] = useState<WaitlistSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchWaitlistSummary(slug, bedrooms)
      .then((s) => {
        if (alive) setSummary(s);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, bedrooms]);

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

  // Position is only present for enrolled (authenticated + on-list) users.
  // For everyone else the banner shows queue depth so the wedge always reads
  // as a real number, not gpmglv's silent black hole.
  const showPosition = summary.position != null;

  const inner = (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone="warn">● {t('waitlist.title')}</Pill>
      {showPosition ? (
        <span className="text-sm font-semibold text-amber-900">
          {t('waitlist.position', { position: summary.position })}
        </span>
      ) : (
        <span className="text-sm font-semibold text-amber-900">
          {summary.totalQueue} on list
        </span>
      )}
      <span className="text-sm text-amber-900/80">
        · {t('waitlist.estimate', { window: summary.expectedNotificationWindow })}
      </span>
    </div>
  );

  // Link to the position screen with the bedrooms tier preserved so the
  // detail view doesn't drop back to the 2BR default.
  return (
    <Link
      to={`/waitlist/position/${slug}?bedrooms=${bedrooms}`}
      className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100"
      role="status"
      aria-live="polite"
      data-testid="waitlist-banner"
    >
      {inner}
    </Link>
  );
}
