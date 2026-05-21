import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 lg:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclosure-title"
    >
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-xl lg:rounded-2xl">
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 id="disclosure-title" className="text-lg font-semibold text-stone-900">
            {t('welcome.disclosure.title')}
          </h2>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm text-stone-700 lg:max-h-[400px]">
          <section className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              HUD-928.1
            </h3>
            <p>{t('welcome.disclosure.fairHousing')}</p>
          </section>
          <section className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              LIHTC
            </h3>
            <p>{t('welcome.disclosure.lihtc')}</p>
          </section>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
              Nevada
            </h3>
            <p>{t('welcome.disclosure.state')}</p>
          </section>
        </div>

        <div className="border-t border-stone-200 px-5 py-4">
          <label className="flex items-start gap-3 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-stone-400 text-emerald-600 focus:ring-emerald-600"
              aria-label={t('welcome.disclosure.ack')}
            />
            <span>{t('welcome.disclosure.ack')}</span>
          </label>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
            >
              {t('welcome.disclosure.cancel')}
            </button>
            <button
              type="button"
              disabled={!acked}
              onClick={onAccept}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {t('welcome.disclosure.accept')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
