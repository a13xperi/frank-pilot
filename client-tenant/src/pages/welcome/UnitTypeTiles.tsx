import { useTranslation } from 'react-i18next';

export type UnitType = 'STUDIO' | '1BR' | '2BR' | '3BR';

interface UnitTypeTilesProps {
  selected: UnitType | null;
  onSelect: (t: UnitType) => void;
}

// Hero photos sourced from the same Unsplash set used by the uh-demo prototype
// (`public/uh-demo/v2/browse-mobile.jsx`). Public CDN, no API key required.
const PHOTOS: Record<UnitType, string> = {
  STUDIO:
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=600&q=70',
  '1BR':
    'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=600&q=70',
  '2BR':
    'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=600&q=70',
  '3BR':
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=600&q=70',
};

const TYPES: UnitType[] = ['STUDIO', '1BR', '2BR', '3BR'];

export function UnitTypeTiles({ selected, onSelect }: UnitTypeTilesProps) {
  const { t } = useTranslation('welcome');
  return (
    <div
      role="radiogroup"
      aria-label={t('step2_label')}
      className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
    >
      {TYPES.map((type) => {
        const active = selected === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(type)}
            className={[
              'group relative flex flex-col overflow-hidden rounded-xl border text-left transition',
              'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2',
              active
                ? 'border-emerald-600 ring-2 ring-emerald-600 shadow-md'
                : 'border-stone-300 hover:border-stone-400',
            ].join(' ')}
          >
            <div
              className="h-24 w-full bg-stone-200 bg-cover bg-center lg:h-32"
              style={{ backgroundImage: `url(${PHOTOS[type]})` }}
              aria-hidden="true"
            />
            <div className="p-3">
              <div className="text-sm font-semibold text-stone-900">
                {t(`unitTypes.${type}`)}
              </div>
              <div className="text-xs text-stone-500">
                {t(`unitTypes_sub.${type}`)}
              </div>
            </div>
            {active && (
              <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
