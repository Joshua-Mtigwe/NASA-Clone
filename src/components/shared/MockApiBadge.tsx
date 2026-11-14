import { Server } from 'lucide-react';
import type { ApiMode } from '@/config/env';
import { apiMode as configuredMode } from '@/config/env';
import { cn } from '@/lib/utils';

export interface MockApiBadgeProps {
  mode?: ApiMode;
  className?: string;
}

/** Visible whenever the app talks to MSW mock handlers instead of the real backend. */
export function MockApiBadge({ mode = configuredMode, className }: MockApiBadgeProps) {
  if (mode !== 'mock') return null;
  return (
    <span
      role="note"
      title="Responses come from MSW handlers backed by the CSV fixtures"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent-muted/40 px-2.5 py-1 text-label font-medium text-accent-strong',
        className,
      )}
    >
      <Server className="h-3.5 w-3.5" aria-hidden="true" />
      Mock API
    </span>
  );
}
