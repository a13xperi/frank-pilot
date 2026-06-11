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
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 ring-1 ring-inset ring-brand-200/50">
          <Icon className="h-5 w-5 text-brand-600" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {description && <p className="mt-0.5 text-13 text-gray-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
