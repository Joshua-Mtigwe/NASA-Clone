import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SyntheticBadgeProps {
  /** Backend data_mode (for example "synthetic_demo") or the is_synthetic flag. */
  dataMode: string | null | undefined;
  isSynthetic?: boolean;
  className?: string;
}

/** Persistent header badge shown whenever the data source is synthetic. */
export function SyntheticBadge({ dataMode, isSynthetic, className }: SyntheticBadgeProps) {
  const synthetic =
    isSynthetic ?? (dataMode ? dataMode.toLowerCase().includes('synthetic') : false);
  if (!synthetic) return null;
  return (
    <span
      role="note"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-status-review/50 bg-status-review-bg px-2.5 py-1 text-label font-medium text-status-review',
        className,
      )}
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
      Synthetic demonstration data
    </span>
  );
}
