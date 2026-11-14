import { CheckCircle2, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from './useConnectionStatus';

const SPEC: Record<ConnectionStatus, { label: string; icon: LucideIcon; className: string }> = {
  offline: { label: 'Offline', icon: WifiOff, className: 'text-status-action' },
  syncing: { label: 'Syncing', icon: RefreshCw, className: 'text-status-review' },
  synced: { label: 'Synced', icon: CheckCircle2, className: 'text-status-nominal' },
};

export function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const spec = SPEC[status];
  const Icon = spec.icon;
  return (
    <span
      role="status"
      aria-label={`Connection: ${spec.label}`}
      data-connection={status}
      className={cn('inline-flex items-center gap-1.5 text-label font-medium', spec.className)}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5',
          status === 'syncing' && 'animate-spin motion-reduce:animate-none',
        )}
        aria-hidden="true"
      />
      {spec.label}
    </span>
  );
}
