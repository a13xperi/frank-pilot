import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Sprout } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  loading?: boolean;
  /** When set, renders an error state instead of the (misleading) empty state. */
  error?: string | null;
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  emptyMessage = 'Nothing here just yet — new records will appear as your team adds them.',
  loading,
  error,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div
        className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm"
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
        className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-8 py-12 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100">
          <Sprout className="h-6 w-6 text-brand-700" aria-hidden="true" />
        </div>
        <p className="mx-auto max-w-md text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${col.className || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={(row as Record<string, unknown>).id as string || String(i)}
                onClick={() => onRowClick?.(row)}
                {...(onRowClick
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
                className={`border-b border-gray-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.className || ''}`}>
                    {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
