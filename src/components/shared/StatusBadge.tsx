import {
  CheckCircle2,
  CircleSlash,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type Status = 'nominal' | 'review' | 'action' | 'no_data';

const STATUS: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  nominal: {
    label: 'Nominal',
    icon: CheckCircle2,
    className: 'border-status-nominal/40 bg-status-nominal-bg text-status-nominal',
  },
  review: {
    label: 'Review',
    icon: TriangleAlert,
    className: 'border-status-review/40 bg-status-review-bg text-status-review',
  },
  action: {
    label: 'Action needed',
    icon: OctagonAlert,
    className: 'border-status-action/40 bg-status-action-bg text-status-action',
  },
  no_data: {
    label: 'No data',
    icon: CircleSlash,
    className: 'border-status-nodata/30 bg-status-nodata-bg text-status-nodata',
  },
};

export interface StatusBadgeProps {
  status: Status;
  /** Overrides the default text; the status meaning is still announced. */
  label?: string;
  className?: string;
}

/** Status is always shown as colour + text + icon, never colour alone. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const spec = STATUS[status];
  const Icon = spec.icon;
  const text = label ?? spec.label;
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-label font-medium',
        spec.className,
        className,
      )}
    >
      <Icon
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
        data-testid={`status-icon-${status}`}
      />
      <span>{text}</span>
      {label && label !== spec.label && <span className="sr-only">(status: {spec.label})</span>}
    </span>
  );
}
