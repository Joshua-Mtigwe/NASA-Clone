import { Card } from '@/components/ui/card';
import { formatNumber, formatTimestamp, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StatusBadge, type Status } from './StatusBadge';

export interface MeasurementCardProps {
  label: string;
  /** null/undefined renders "No data"; the card never invents a value. */
  value: number | null | undefined;
  unit: string | null | undefined;
  measuredAt?: string | null;
  source?: string | null;
  quality?: string | null;
  provenance?: 'measured' | 'estimated' | null;
  /** Backend-assigned status; the card does not derive one. */
  status?: Status;
  fractionDigits?: number;
  className?: string;
}

export function MeasurementCard({
  label,
  value,
  unit,
  measuredAt,
  source,
  quality,
  provenance,
  status,
  fractionDigits = 1,
  className,
}: MeasurementCardProps) {
  const hasValue = typeof value === 'number' && Number.isFinite(value);
  const headingId = `measure-${label.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <Card
      className={cn('flex flex-col gap-3 p-5', className)}
      role="group"
      aria-labelledby={headingId}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={headingId} className="text-label uppercase text-ink-muted">
          {label}
        </h3>
        {provenance && (
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-caption font-medium',
              provenance === 'measured'
                ? 'border-accent/40 text-accent-strong'
                : 'border-status-review/40 text-status-review',
            )}
          >
            {provenance === 'measured' ? 'Measured' : 'Estimated'}
          </span>
        )}
      </div>

      {hasValue ? (
        <p className="flex items-baseline gap-1.5">
          <span className="text-metric text-ink">{formatNumber(value, fractionDigits)}</span>
          {unit && <span className="text-body text-ink-muted">{unit}</span>}
        </p>
      ) : (
        <p className="text-metric-sm text-ink-subtle">No data</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption text-ink-subtle">
        <dt>Time</dt>
        <dd className="text-ink-muted">{hasValue ? formatTimestamp(measuredAt) : '—'}</dd>
        <dt>Source</dt>
        <dd className="text-ink-muted">{source ? humanise(source) : 'Not reported'}</dd>
        <dt>Quality</dt>
        <dd className="text-ink-muted">{quality ? humanise(quality) : 'Not reported'}</dd>
      </dl>

      {!hasValue ? (
        <StatusBadge status="no_data" className="self-start" />
      ) : (
        status && <StatusBadge status={status} className="self-start" />
      )}
    </Card>
  );
}
