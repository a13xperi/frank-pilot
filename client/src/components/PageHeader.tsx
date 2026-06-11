import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ icon: Icon, title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-200 pb-6">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-200 bg-brand-50">
          <Icon className="h-5 w-5 text-brand-700" />
        </div>
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-gray-900">
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
