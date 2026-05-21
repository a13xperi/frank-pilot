import { useTranslation } from 'react-i18next';
import { HF } from '@/styles/tokens';

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
            className="group relative flex flex-col overflow-hidden text-left transition focus:outline-none"
            style={{
              background: HF.paper,
              border: `1px solid ${active ? HF.accent : HF.border}`,
              borderRadius: HF.r.lg,
              boxShadow: active
                ? `${HF.shadow.md}, 0 0 0 2px ${HF.accent}`
                : HF.shadow.xs,
              color: HF.ink,
              fontFamily: HF.body,
            }}
          >
            <div
              className="h-24 w-full bg-cover bg-center lg:h-32"
              style={{
                backgroundImage: `url(${PHOTOS[type]})`,
                backgroundColor: HF.borderHi,
              }}
              aria-hidden="true"
            />
            <div className="p-3">
              <div
                className="text-sm"
                style={{
                  fontFamily: HF.display,
                  fontWeight: 700,
                  color: HF.ink,
                }}
              >
                {t(`unitTypes.${type}`)}
              </div>
              <div className="text-xs" style={{ color: HF.ink3 }}>
                {t(`unitTypes_sub.${type}`)}
              </div>
            </div>
            {active && (
              <span
                className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center text-xs"
                style={{
                  background: HF.accent,
                  color: HF.accentInk,
                  borderRadius: HF.r.pill,
                  fontWeight: 700,
                }}
                aria-hidden="true"
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
