import type { HTMLAttributes, ReactNode, Key } from 'react';
import { HF } from '@/styles/tokens';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  variant?: 'mobile' | 'desktop';
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => Key;
  empty?: ReactNode;
}

/**
 * DataTable — desktop renders as proper table; mobile renders as stacked cards
 * (each row is a Card with label/value pairs). variant prop forces one or the other.
 */
export function DataTable<T>({
  variant,
  columns,
  rows,
  rowKey,
  empty = 'No data',
  className = '',
  ...rest
}: DataTableProps<T>) {
  const forceMobile = variant === 'mobile';
  const forceDesktop = variant === 'desktop';

  if (rows.length === 0) {
    return (
      <div
        className={`p-6 text-center ${className}`}
        style={{ color: HF.ink3, background: HF.paper, border: `1px solid ${HF.border}`, borderRadius: HF.r.md }}
        {...rest}
      >
        {empty}
      </div>
    );
  }

  const desktopTable = (
    <table className="w-full text-left" style={{ borderCollapse: 'collapse', fontFamily: HF.body }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              className={`px-4 py-3 text-xs uppercase tracking-wide ${c.className ?? ''}`}
              style={{
                color: HF.ink3,
                borderBottom: `1px solid ${HF.border}`,
                background: HF.paperHi,
                fontWeight: 700,
                letterSpacing: '0.06em',
              }}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row, i)} style={{ borderBottom: `1px solid ${HF.border}` }}>
            {columns.map((c) => (
              <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ''}`} style={{ color: HF.ink }}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const mobileCards = (
    <div className="flex flex-col gap-3" style={{ fontFamily: HF.body }}>
      {rows.map((row, i) => (
        <div
          key={rowKey(row, i)}
          style={{
            background: HF.paper,
            border: `1px solid ${HF.border}`,
            borderRadius: HF.r.md,
            padding: 12,
          }}
        >
          {columns.map((c) => (
            <div key={c.key} className="flex justify-between gap-2 py-1 text-sm">
              <span style={{ color: HF.ink3, fontWeight: 600 }}>{c.header}</span>
              <span className="text-right" style={{ color: HF.ink }}>{c.render(row)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div
      data-variant={variant ?? 'auto'}
      className={`w-full ${className}`}
      style={{ background: HF.paper, borderRadius: HF.r.md, overflow: 'hidden' }}
      {...rest}
    >
      {forceMobile ? (
        mobileCards
      ) : forceDesktop ? (
        desktopTable
      ) : (
        <>
          <div className="lg:hidden">{mobileCards}</div>
          <div className="hidden lg:block">{desktopTable}</div>
        </>
      )}
    </div>
  );
}

export default DataTable;
