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
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-3.5">
        <div className="rounded-xl bg-brand-100 p-2.5">
          <Icon className="h-5 w-5 text-brand-700" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
