import type { ReactNode } from 'react';
import { usePageTitle } from '@/lib/usePageTitle';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  usePageTitle(title);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-heading">{title}</h1>
        {description && <p className="text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
