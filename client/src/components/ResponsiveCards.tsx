import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Column } from './DataTable';

interface ResponsiveCardsProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
  error?: string | null;
  /** Extra classes for the outer wrapper (call sites pass `md:hidden`). */
  className?: string;
}

/**
 * Stacked-card presentation of tabular data for narrow viewports.
 *
 * This is the below-`md` companion to {@link DataTable}: call sites render the
 * `<table>` at `md+` and this card list below `md`. It deliberately reuses the
 * same `Column<T>` definitions, `data`, and `onRowClick` so the two stay in
 * lockstep — only the presentation differs. Loading / error / empty states
 * mirror DataTable so mobile users never see a blank where the table would be.
 *
 * Each row becomes a card of `header: value` pairs. Columns with an empty
 * `header` (e.g. an icon-only column) render their value without a label.
 */
export function ResponsiveCards<T>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No data found',
  loading,
  error,
  className = '',
}: ResponsiveCardsProps<T>) {
  if (loading) {
    return (
      <div
        className={`rounded-xl border border-gray-200 bg-white p-8 text-center ${className}`}
        role="status"
        aria-live="polite"
        aria-label="Loading"
      >
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 ${className}`}
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 ${className}`}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {data.map((row, i) => {
        const key = ((row as Record<string, unknown>).id as string) || String(i);
        const interactive = !!onRowClick;
        return (
          <div
            key={key}
            onClick={() => onRowClick?.(row)}
            {...(interactive
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': 'View details',
                  onKeyDown: (e: ReactKeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  },
                }
              : {})}
            className={`rounded-xl border border-gray-200 bg-white p-4 shadow-card ${
              interactive
                ? 'cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500'
                : ''
            }`}
          >
            <dl className="space-y-1.5">
              {columns.map((col) => {
                const value: ReactNode = col.render
                  ? col.render(row)
                  : String((row as Record<string, unknown>)[col.key] ?? '—');
                if (!col.header) {
                  return (
                    <div key={col.key} className="text-sm text-gray-700">
                      {value}
                    </div>
                  );
                }
                return (
                  <div key={col.key} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="shrink-0 font-medium text-gray-500">{col.header}</dt>
                    <dd className="text-right text-gray-800">{value}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
