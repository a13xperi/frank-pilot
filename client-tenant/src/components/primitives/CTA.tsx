import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'mobile' | 'desktop';
  intent?: 'primary' | 'secondary';
  full?: boolean;
  children: ReactNode;
}

export function CTA({
  variant: _variant = 'desktop',
  intent = 'primary',
  full = false,
  className = '',
  children,
  ...rest
}: Props) {
  const intentClasses =
    intent === 'primary'
      ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
      : 'bg-white text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 ${intentClasses} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
