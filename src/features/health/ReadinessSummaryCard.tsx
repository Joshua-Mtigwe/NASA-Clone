import { CheckCircle2, CircleSlash, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReadinessFactor, ReadinessSummary, ReferenceRangeStatus } from '@/api/types';
import { StatusBadge } from '@/components/shared';
import { Card } from '@/components/ui/card';
import { formatNumber, formatTimestamp, formatUnit, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { factorLabel } from './config';

const GROUPS: Array<{
  status: ReferenceRangeStatus;
  title: string;
  icon: LucideIcon;
  segment: string;
  text: string;
}> = [
  {
    status: 'within_reference',
    title: 'Within your personal reference',
    icon: CheckCircle2,
    segment: 'bg-status-nominal/80',
    text: 'text-status-nominal',
  },
  {
    status: 'outside_reference',
    title: 'Needs review',
    icon: TriangleAlert,
    segment: 'bg-status-review/80',
    text: 'text-status-review',
  },
  {
    status: 'no_data',
    title: 'No data',
    icon: CircleSlash,
    segment: 'bg-status-nodata/30',
    text: 'text-status-nodata',
  },
];

function referenceText(f: ReadinessFactor): string {
  const u = formatUnit(f.unit);
  const value = f.value === null ? 'No data' : `${formatNumber(f.value, 1)}${u ? ` ${u}` : ''}`;
  if (f.reference_lower === null || f.reference_upper === null)
    return `${value} · no reference yet`;
  return `${value} · reference ${formatNumber(f.reference_lower, 1)}–${formatNumber(f.reference_upper, 1)}${u ? ` ${u}` : ''}`;
}

/**
 * Battery-style summary: one segment per factor, grouped by the status the backend
 * assigned. It deliberately shows no percentage and no combined score.
 */
export function ReadinessSummaryCard({ summary }: { summary: ReadinessSummary }) {
  const grouped = GROUPS.map((g) => ({
    ...g,
    factors: summary.factors.filter((f) => f.reference_range_status === g.status),
  }));
  const ordered = grouped.flatMap((g) => g.factors.map((f) => ({ f, g })));
  const op = summary.operational;

  return (
    <Card className="space-y-4 p-5" aria-labelledby="readiness-title" role="region">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="readiness-title" className="text-title">
          Daily readiness summary
        </h2>
        <p className="text-caption text-ink-subtle">As of {formatTimestamp(summary.as_of)}</p>
      </div>

      <div
        role="img"
        aria-label={grouped.map((g) => `${g.factors.length} ${g.title.toLowerCase()}`).join(', ')}
        className="flex h-9 gap-0.5 rounded-md border border-ink-subtle/50 p-1"
        data-testid="readiness-battery"
      >
        {ordered.map(({ f, g }) => {
          const Icon = g.icon;
          return (
            <span
              key={f.factor}
              title={`${factorLabel(f.factor)}: ${g.title}`}
              data-status={g.status}
              className={cn('flex flex-1 items-center justify-center rounded-sm', g.segment)}
            >
              <Icon className="h-3.5 w-3.5 text-navy-950" aria-hidden="true" />
            </span>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {grouped.map((g) => {
          const Icon = g.icon;
          return (
            <section key={g.status} aria-label={g.title}>
              <h3 className={cn('mb-2 flex items-center gap-1.5 text-label font-medium', g.text)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {g.title} ({g.factors.length})
              </h3>
              {g.factors.length === 0 ? (
                <p className="text-caption text-ink-subtle">None</p>
              ) : (
                <ul className="space-y-1.5">
                  {g.factors.map((f) => (
                    <li key={f.factor} className="text-sm">
                      <span className="text-ink">{factorLabel(f.factor)}</span>
                      <span className="block text-caption text-ink-subtle">{referenceText(f)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
        <span className="text-ink-muted">Operational readiness:</span>
        {op ? (
          <>
            <span className="text-ink">
              Assessment {humanise(op.assessment_completion_status).toLowerCase()} ·{' '}
              {humanise(op.operational_eligibility_status)} · workload limit{' '}
              {op.workload_limit_minutes} min
            </span>
            <StatusBadge status="review" label="Unverified demonstration data" />
          </>
        ) : (
          <StatusBadge status="no_data" />
        )}
      </div>
    </Card>
  );
}
