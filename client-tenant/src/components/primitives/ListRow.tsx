import type { ReactNode } from 'react';

export function ListRow({
  leading,
  children,
  trailing,
}: {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      {leading && <div className="mt-0.5 shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1 text-sm text-gray-800">{children}</div>
      {trailing && <div className="ml-2 shrink-0">{trailing}</div>}
    </div>
  );
}
