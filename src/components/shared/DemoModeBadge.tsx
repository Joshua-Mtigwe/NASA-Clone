import { FlaskRound } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shown on every page of a demonstration-mode session: the role was picked from a
 * public selector, so nothing on screen is protected by authentication.
 */
export function DemoModeBadge({ className }: { className?: string }) {
  return (
    <span
      role="note"
      title="Opened from the public role selector. Demonstration mode is not secure authentication."
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-violet-400/50 bg-violet-950/40 px-2.5 py-1 text-label font-medium text-violet-200',
        className,
      )}
    >
      <FlaskRound className="h-3.5 w-3.5" aria-hidden="true" />
      Demo mode
    </span>
  );
}
