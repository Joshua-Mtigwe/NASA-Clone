import { AlertOctagon, CircleSlash, Inbox, Loader2, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type DataStatus = 'loading' | 'empty' | 'error' | 'no-data' | 'ready';

export interface DataStateProps {
  status: DataStatus;
  children?: ReactNode;
  /** Shown when the request succeeded but returned nothing. */
  emptyMessage?: string;
  /** Shown when a value is expected but not recorded. */
  noDataMessage?: string;
  loadingMessage?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

function errorText(error: unknown): { title: string; message: string; forbidden: boolean } {
  if (isApiError(error)) {
    if (error.kind === 'forbidden') {
      return { title: 'Access restricted', message: error.message, forbidden: true };
    }
    return { title: 'Could not load data', message: error.message, forbidden: false };
  }
  if (error instanceof Error && error.message) {
    return { title: 'Could not load data', message: error.message, forbidden: false };
  }
  return { title: 'Could not load data', message: 'Something went wrong.', forbidden: false };
}

/** One component for every data view's loading, empty, error and no-data states. */
export function DataState({
  status,
  children,
  emptyMessage = 'Nothing to show yet.',
  noDataMessage = 'No data',
  loadingMessage = 'Loading…',
  error,
  onRetry,
  className,
}: DataStateProps) {
  if (status === 'ready') return <>{children}</>;

  const frame = cn(
    'flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center',
    className,
  );

  if (status === 'loading') {
    return (
      <div className={frame} role="status" aria-live="polite" aria-busy="true">
        <Loader2
          className="h-5 w-5 animate-spin text-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p className="text-ink-muted">{loadingMessage}</p>
      </div>
    );
  }

  if (status === 'error') {
    const { title, message, forbidden } = errorText(error);
    const Icon = forbidden ? ShieldAlert : AlertOctagon;
    return (
      <div className={cn(frame, 'border-status-action/40')} role="alert">
        <Icon className="h-5 w-5 text-status-action" aria-hidden="true" />
        <p className="font-medium text-ink">{title}</p>
        <p className="text-ink-muted">{message}</p>
        {onRetry && !forbidden && (
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (status === 'no-data') {
    return (
      <div className={frame} role="status">
        <CircleSlash className="h-5 w-5 text-status-nodata" aria-hidden="true" />
        <p className="text-ink-muted">{noDataMessage}</p>
      </div>
    );
  }

  return (
    <div className={frame} role="status">
      <Inbox className="h-5 w-5 text-ink-subtle" aria-hidden="true" />
      <p className="text-ink-muted">{emptyMessage}</p>
    </div>
  );
}
