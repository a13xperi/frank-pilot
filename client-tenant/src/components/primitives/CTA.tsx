import type { ButtonHTMLAttributes } from 'react';

interface CTAProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variantStyle?: 'primary' | 'secondary' | 'ghost';
  fullWidth?: boolean;
}

export function CTA({
  variantStyle = 'primary',
  fullWidth = true,
  className = '',
  children,
  ...rest
}: CTAProps) {
  const base =
    variantStyle === 'primary'
      ? 'btn-primary'
      : variantStyle === 'secondary'
      ? 'rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'
      : 'text-sm text-gray-500 hover:text-gray-700 hover:underline';
  return (
    <button
      className={`${base} ${fullWidth && variantStyle === 'primary' ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
