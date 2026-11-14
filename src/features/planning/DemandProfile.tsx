import type { PlanningTask } from '@/api/types';
import { DEMAND_ITEMS, demandValues, isLeaderReviewed } from './demand';
import { cn } from '@/lib/utils';

/** 0–5 bars for each demand. Labelled as an unvalidated AI proposal until the leader edits it. */
export function DemandProfile({ task }: { task: PlanningTask }) {
  const values = demandValues(task);
  return (
    <div className="space-y-1.5" data-testid="demand-profile">
      <p
        className={cn(
          'text-caption',
          isLeaderReviewed(task) ? 'text-ink-muted' : 'text-status-review',
        )}
      >
        {isLeaderReviewed(task) ? 'Edited by the mission leader' : 'Proposed by AI, not validated'}
      </p>
      {DEMAND_ITEMS.map((item) => {
        const v = values[item.key];
        return (
          <div
            key={item.key}
            className="flex items-center gap-2 text-caption"
            aria-label={`${item.label}: ${v === null ? 'No data' : `${v} of 5`}`}
            role="img"
          >
            <span className="w-36 shrink-0 text-ink-muted">{item.label}</span>
            {v === null ? (
              <span className="text-ink-subtle">No data</span>
            ) : (
              <span className="flex gap-0.5" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    className={cn('h-2.5 w-5 rounded-sm', n <= v ? 'bg-accent' : 'bg-navy-700')}
                  />
                ))}
              </span>
            )}
            {v !== null && <span className="text-ink">{v}</span>}
          </div>
        );
      })}
    </div>
  );
}
