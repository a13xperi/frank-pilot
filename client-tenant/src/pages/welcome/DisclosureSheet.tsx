import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';
import { CTA } from '@/components/primitives/CTA';

interface DisclosureSheetProps {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * HUD-928.1 Fair Housing notice + LIHTC + state disclosures.
 *
 * Required acknowledge checkbox before the Accept CTA enables. Lane E will
 * instrument the accept transition with the "Welcome Letter delivered"
 * (HUD 4350.3 Ch. 4-4) tape stamp; this component only emits the callback.
 *
 * Mobile: bottom sheet (sticky to viewport bottom).
 * Desktop: centered modal.
 */
export function DisclosureSheet({ open, onAccept, onCancel }: DisclosureSheetProps) {
  const { t } = useTranslation('welcome');
  const [acked, setAcked] = useState(false);

  // Reset acknowledgement when sheet closes.
  useEffect(() => {
    if (!open) setAcked(false);
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape to cancel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const sectionLabelStyle = {
    color: HF.ink3,
    fontFamily: HF.body,
  } as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclosure-title"
      style={{ background: 'rgba(31, 26, 18, 0.45)' }}
    >
      <div
        className="w-full max-w-lg"
        style={{
          background: HF.paper,
          color: HF.ink,
          fontFamily: HF.body,
          borderTopLeftRadius: HF.r.xl,
          borderTopRightRadius: HF.r.xl,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          boxShadow: HF.shadow.lg,
        }}
      >
        <div
          className="px-5 py-4"
          style={{ borderBottom: `1px solid ${HF.border}` }}
        >
          <h2
            id="disclosure-title"
            className="text-lg"
            style={{
              fontFamily: HF.display,
              fontWeight: 700,
              color: HF.ink,
            }}
          >
            {t('disclosure.title')}
          </h2>
        </div>

        <div
          className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm lg:max-h-[400px]"
          style={{ color: HF.ink2 }}
        >
          <section className="mb-4">
            <h3
              className="mb-1 text-xs font-semibold uppercase tracking-wide"
              style={sectionLabelStyle}
            >
              HUD-928.1
            </h3>
            <p>{t('disclosure.fairHousing')}</p>
          </section>
          <section className="mb-4">
            <h3
              className="mb-1 text-xs font-semibold uppercase tracking-wide"
              style={sectionLabelStyle}
            >
              LIHTC
            </h3>
            <p>{t('disclosure.lihtc')}</p>
          </section>
          <section>
            <h3
              className="mb-1 text-xs font-semibold uppercase tracking-wide"
              style={sectionLabelStyle}
            >
              Nevada
            </h3>
            <p>{t('disclosure.state')}</p>
          </section>
        </div>

        <div
          className="px-5 py-4"
          style={{ borderTop: `1px solid ${HF.border}` }}
        >
          <label
            className="flex items-start gap-3 text-sm"
            style={{ color: HF.ink }}
          >
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
              className="mt-0.5 h-5 w-5"
              style={{ accentColor: HF.accent }}
              aria-label={t('disclosure.ack')}
            />
            <span>{t('disclosure.ack')}</span>
          </label>

          <div className="mt-4 flex gap-3">
            <CTA
              type="button"
              tone="secondary"
              onClick={onCancel}
              block
              style={{ flex: 1 }}
            >
              {t('disclosure.cancel')}
            </CTA>
            <CTA
              type="button"
              tone="primary"
              disabled={!acked}
              onClick={onAccept}
              block
              style={{ flex: 1 }}
            >
              {t('disclosure.accept')}
            </CTA>
          </div>
        </div>
      </div>
    </div>
  );
}
