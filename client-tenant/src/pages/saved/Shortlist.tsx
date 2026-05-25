import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Heart, Bell, BellOff } from 'lucide-react';
import {
  getShortlist,
  toggleAlert,
  type SavedListGroup,
  type SavedListItem,
} from '@/api/saved';
import { unsave as unsaveSlug, refreshShortlist } from '@/state/shortlist';
import { getToken } from '@/api/client';
import { placeholderFor } from '@/utils/unitPlaceholder';
import { HF } from '@/styles/tokens';

/** "$900–$1,400" / "$900" / "" depending on which bounds are present. */
function formatRentRange(min: number | null, max: number | null): string {
  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
  if (min != null && max != null) {
    return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  }
  if (min != null) return `${fmt(min)}+`;
  if (max != null) return fmt(max);
  return '';
}

export function Shortlist() {
  const { t } = useTranslation('discover');
  const navigate = useNavigate();
  const [lists, setLists] = useState<SavedListGroup[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getShortlist();
      setLists(res.lists);
      setCount(res.count);
    } catch {
      // A guest with no saves (no cookie yet) reads as an empty list, not an
      // error — only surface real failures.
      setLists([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUnsave = async (item: SavedListItem) => {
    // Optimistically drop from the local view; the store handles its own
    // rollback if the API rejects.
    setLists((prev) =>
      prev
        .map((g) =>
          g.listName === item.listName
            ? { ...g, items: g.items.filter((i) => i.propertySlug !== item.propertySlug) }
            : g,
        )
        .filter((g) => g.items.length > 0),
    );
    setCount((c) => Math.max(0, c - 1));
    const ok = await unsaveSlug(item.propertySlug, item.listName);
    if (!ok) {
      // Reconcile against the server on failure.
      await load();
      await refreshShortlist();
    }
  };

  const onToggleAlert = async (item: SavedListItem) => {
    const next = !item.alertEnabled;
    // Optimistic flip.
    setLists((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((i) =>
          i.propertySlug === item.propertySlug && i.listName === item.listName
            ? { ...i, alertEnabled: next }
            : i,
        ),
      })),
    );
    try {
      await toggleAlert(item.propertySlug, next);
    } catch {
      await load();
    }
  };

  const onApply = (item: SavedListItem) => {
    const qs = new URLSearchParams({ propertyId: item.propertySlug });
    const target = `/apply?${qs.toString()}`;
    navigate(getToken() ? target : `/login?return=${encodeURIComponent(target)}`);
  };

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', fontFamily: HF.body, color: HF.ink }}
    >
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link
          to="/discover"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            color: HF.accent,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          <ArrowLeft className="h-4 w-4" /> {t('detail.back')}
        </Link>

        <header className="mb-4" style={{ marginTop: 12 }}>
          <h1
            style={{
              fontFamily: HF.display,
              fontWeight: 800,
              fontSize: 22,
              color: HF.ink,
              letterSpacing: '-0.01em',
            }}
          >
            {t('saved.title')}
          </h1>
          {count > 0 && (
            <p style={{ marginTop: 4, fontSize: 14, color: HF.ink3 }}>
              {t('saved.count', { count })}
            </p>
          )}
        </header>

        {loading ? (
          <p style={{ fontSize: 14, color: HF.ink3 }}>{t('saved.loading')}</p>
        ) : error ? (
          <p style={{ fontSize: 14, color: HF.err }}>{error}</p>
        ) : count === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col" style={{ gap: 28 }}>
            {lists.map((group) => (
              <section key={group.listName} data-testid={`saved-list-${group.listName}`}>
                {/* Show the list heading only when there's more than one list,
                    or it isn't the default — keeps the single-list case clean. */}
                {(lists.length > 1 || group.listName.toLowerCase() !== 'default') && (
                  <h2
                    style={{
                      fontFamily: HF.display,
                      fontWeight: 700,
                      fontSize: 15,
                      color: HF.ink2,
                      margin: '0 0 10px',
                    }}
                  >
                    {group.listName}
                  </h2>
                )}
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <SavedCard
                      key={`${group.listName}:${item.propertySlug}`}
                      item={item}
                      onUnsave={() => onUnsave(item)}
                      onToggleAlert={() => onToggleAlert(item)}
                      onApply={() => onApply(item)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation('discover');
  return (
    <div
      data-testid="saved-empty"
      style={{
        background: HF.paper,
        border: `1px solid ${HF.border}`,
        borderRadius: HF.r.md,
        padding: '40px 24px',
        textAlign: 'center',
        boxShadow: HF.shadow.xs,
      }}
    >
      <Heart
        width={32}
        height={32}
        aria-hidden="true"
        style={{ color: HF.ink4, margin: '0 auto 12px', display: 'block' }}
      />
      <p style={{ fontSize: 15, fontWeight: 700, color: HF.ink, margin: 0 }}>
        {t('saved.empty.heading')}
      </p>
      <p style={{ fontSize: 14, color: HF.ink3, margin: '6px 0 16px' }}>
        {t('saved.empty.body')}
      </p>
      <Link
        to="/discover"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: HF.accent,
          color: HF.paper,
          borderRadius: HF.r.md,
          padding: '10px 16px',
          fontSize: 14,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {t('saved.empty.cta')}
      </Link>
    </div>
  );
}

function SavedCard({
  item,
  onUnsave,
  onToggleAlert,
  onApply,
}: {
  item: SavedListItem;
  onUnsave: () => void;
  onToggleAlert: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation('discover');
  const rent = formatRentRange(item.rentMin, item.rentMax);
  const available = item.availableCount > 0;

  return (
    <li>
      <div
        data-testid={`saved-card-${item.propertySlug}`}
        style={{
          background: HF.paper,
          border: `1px solid ${HF.border}`,
          borderRadius: HF.r.md,
          overflow: 'hidden',
          boxShadow: HF.shadow.sm,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        <div className="relative">
          <Link to={`/property/${item.propertySlug}`} aria-label={item.name}>
            <div
              className="aspect-[16/9] w-full"
              style={{
                background: HF.sageLo,
                backgroundImage: `url(${placeholderFor(item.propertySlug)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
              aria-hidden="true"
            />
          </Link>
          {/* Unsave (♥) — filled because everything on this page is saved. */}
          <button
            type="button"
            onClick={onUnsave}
            aria-label={t('saved.remove', { name: item.name })}
            title={t('saved.removeShort')}
            data-testid={`saved-unsave-${item.propertySlug}`}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 36,
              width: 36,
              borderRadius: HF.r.pill,
              border: 'none',
              background: HF.paper,
              boxShadow: HF.shadow.sm,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <Heart
              width={18}
              height={18}
              style={{ color: HF.accent, fill: HF.accent }}
              aria-hidden="true"
            />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Link
            to={`/property/${item.propertySlug}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <h3
              style={{
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 16,
                color: HF.ink,
                margin: 0,
                lineHeight: 1.25,
              }}
            >
              {item.name}
            </h3>
          </Link>

          <div className="flex items-center" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {item.amiTier && (
              <span
                style={{
                  background: HF.sageLo,
                  color: HF.sage,
                  border: `1px solid ${HF.border}`,
                  borderRadius: HF.r.pill,
                  padding: '2px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {t('amiDisclosure.chipLabel', { tier: item.amiTier })}
              </span>
            )}
            <span
              data-testid={`saved-availability-${item.propertySlug}`}
              style={{
                background: available ? HF.sageLo : HF.paper,
                color: available ? HF.ink2 : HF.ink3,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.pill,
                padding: '2px 10px',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {available
                ? t('badge.available', { count: item.availableCount })
                : t('badge.fullyLeased')}
            </span>
          </div>

          {rent && (
            <p
              style={{
                marginTop: 10,
                fontFamily: HF.display,
                fontWeight: 700,
                fontSize: 14,
                color: HF.ink,
              }}
            >
              {rent}
              <span style={{ fontSize: 12, fontWeight: 500, color: HF.ink3 }}>
                {t('pricing.suffix')}
              </span>
            </p>
          )}

          {/* Vacancy-alert toggle. */}
          <button
            type="button"
            onClick={onToggleAlert}
            aria-pressed={item.alertEnabled}
            data-testid={`saved-alert-${item.propertySlug}`}
            style={{
              marginTop: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: item.alertEnabled ? HF.accentLo : 'transparent',
              color: item.alertEnabled ? HF.accentInk : HF.ink3,
              border: `1px solid ${item.alertEnabled ? '#F3D7CB' : HF.border}`,
              borderRadius: HF.r.pill,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: HF.body,
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            {item.alertEnabled ? (
              <Bell width={14} height={14} aria-hidden="true" />
            ) : (
              <BellOff width={14} height={14} aria-hidden="true" />
            )}
            {item.alertEnabled ? t('saved.alertOn') : t('saved.alertOff')}
          </button>

          <div style={{ flex: 1 }} />

          <div className="flex items-center" style={{ gap: 8, marginTop: 14 }}>
            <Link
              to={`/property/${item.propertySlug}`}
              data-testid={`saved-view-${item.propertySlug}`}
              style={{
                flex: 1,
                textAlign: 'center',
                background: HF.paper,
                color: HF.ink,
                border: `1px solid ${HF.border}`,
                borderRadius: HF.r.md,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {t('list.viewDetails')}
            </Link>
            <button
              type="button"
              onClick={onApply}
              data-testid={`saved-apply-${item.propertySlug}`}
              style={{
                flex: 1,
                background: HF.accent,
                color: HF.paper,
                border: `1px solid ${HF.accent}`,
                borderRadius: HF.r.md,
                padding: '9px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: HF.body,
              }}
            >
              {t('saved.apply')}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

export default Shortlist;
