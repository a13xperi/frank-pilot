import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';

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
  emptyMessage = 'No data found',
  loading,
  error,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div
        className="rounded-lg border border-gray-200 bg-white p-10 text-center"
        role="status"
        aria-live="polite"
        aria-label="Loading"
      >
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  // Classic registry table: strong header rule, full-width hairline row rules.
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-500 ${col.className || ''}`}
                >
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
                className={`border-b border-gray-200 last:border-0 ${onRowClick ? 'cursor-pointer transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500' : ''}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-5 py-3.5 text-gray-700 ${col.className || ''}`}>
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
