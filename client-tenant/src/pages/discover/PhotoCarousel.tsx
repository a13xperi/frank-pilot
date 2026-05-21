import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  photos: string[];
  alt?: string;
  initialIndex?: number;
}

const SWIPE_THRESHOLD = 50;

export function PhotoCarousel({ photos, alt = 'Property photo', initialIndex = 0 }: Props) {
  const { t } = useTranslation('discover');
  const [index, setIndex] = useState(
    Math.min(Math.max(0, initialIndex), Math.max(0, photos.length - 1))
  );
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const count = photos.length;
  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      const wrapped = ((next % count) + count) % count;
      setIndex(wrapped);
    },
    [count]
  );

  const prev = useCallback(() => go(index - 1), [go, index]);
  const next = useCallback(() => go(index + 1), [go, index]);

  // Keyboard nav — only when the carousel has focus or is the active region.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        next();
      } else if (e.key === 'ArrowLeft') {
        prev();
      } else {
        return;
      }
      // Don't preventDefault unless focus is inside the carousel — leave page scroll alone.
      if (
        containerRef.current &&
        document.activeElement &&
        containerRef.current.contains(document.activeElement)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    if (delta < 0) next();
    else prev();
  };

  if (count === 0) {
    return (
      <div
        className="flex aspect-[4/3] w-full items-center justify-center bg-gray-100 text-sm text-gray-500"
        role="img"
        aria-label={alt}
      >
        No photos
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      role="region"
      aria-roledescription="carousel"
      aria-label={alt}
      tabIndex={0}
      data-testid="photo-carousel"
    >
      <div
        className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {photos.map((src, i) => (
          <img
            key={src + i}
            src={src}
            alt={`${alt} ${i + 1} of ${count}`}
            loading="lazy"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              i === index ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden={i !== index}
            data-active={i === index}
          />
        ))}

        {/* Counter */}
        <div className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">
          {t('carousel.counter', { current: index + 1, total: count })}
        </div>

        {/* Desktop arrows — hidden on small screens (use touch instead). */}
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label={t('carousel.prev')}
              onClick={prev}
              className="absolute left-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow ring-1 ring-gray-200 hover:bg-white sm:flex"
              data-testid="carousel-prev"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label={t('carousel.next')}
              onClick={next}
              className="absolute right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-gray-900 shadow ring-1 ring-gray-200 hover:bg-white sm:flex"
              data-testid="carousel-next"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Dots */}
        {count > 1 && (
          <div
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5"
            role="tablist"
          >
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={t('carousel.go', { n: i + 1 })}
                onClick={() => go(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/55'
                }`}
                data-testid={`carousel-dot-${i}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
