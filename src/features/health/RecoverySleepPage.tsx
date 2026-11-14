import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Card } from '@/components/ui/card';
import { formatClock, formatDate, formatMinutes, formatNumber, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { shiftDate } from './config';
import { useAstronautContext, useRecoveryCatalogue, useScheduledRecovery, useSleep } from './hooks';

export function RecoverySleepPage() {
  const { astronautId, missionDate, missionTime } = useAstronautContext();
  const upcoming = missionDate
    ? { from: `${missionDate}T00:00:00Z`, to: `${shiftDate(missionDate, 7)}T00:00:00Z` }
    : null;
  const recent =
    missionDate && missionTime
      ? { from: `${shiftDate(missionDate, -7)}T00:00:00Z`, to: missionTime }
      : null;

  const scheduled = useScheduledRecovery(astronautId, upcoming);
  const catalogue = useRecoveryCatalogue();
  const sleep = useSleep(astronautId, recent);

  const routines = scheduled.data ?? [];
  const activities = new Map((catalogue.data ?? []).map((a) => [a.recovery_activity_id, a]));
  const nights = [...(sleep.data ?? [])].sort((a, b) => b.sleep_start.localeCompare(a.sleep_start));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery and Sleep"
        description="Supportive routines scheduled for you, and your recent sleep."
      />

      <section aria-labelledby="routines-title" className="space-y-3">
        <h2 id="routines-title" className="text-title">
          Supportive routines (next 7 days)
        </h2>
        <p className="text-sm text-ink-muted">
          Short routines that can support rest and recovery alongside your mission schedule.
        </p>
        <DataState
          status={statusOf(
            {
              isPending: scheduled.isPending || catalogue.isPending,
              isError: scheduled.isError || catalogue.isError,
            },
            routines.length === 0,
          )}
          error={scheduled.error ?? catalogue.error}
          onRetry={() => {
            void scheduled.refetch();
            void catalogue.refetch();
          }}
          emptyMessage="No supportive routines are scheduled in the next 7 days."
        >
          <ul className="grid gap-3 md:grid-cols-2">
            {routines.map((r) => {
              const a = activities.get(r.recovery_activity_id);
              return (
                <li key={r.scheduled_recovery_id}>
                  <Card className="space-y-2 p-4" data-testid="routine">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-medium text-ink">
                          {a?.activity_name ?? r.recovery_activity_id}
                        </h3>
                        <p className="text-caption text-ink-subtle">
                          {a
                            ? `${humanise(a.activity_category)} · ${humanise(a.intensity)} intensity`
                            : 'Routine details unavailable'}
                        </p>
                      </div>
                      <span className="text-label text-ink-muted">
                        {humanise(r.completion_status)}
                      </span>
                    </div>
                    <p className="text-sm text-ink">
                      {formatDate(r.scheduled_start)}, {formatClock(r.scheduled_start)}–
                      {formatClock(r.scheduled_end)} UTC
                    </p>
                    {a?.description && <p className="text-sm text-ink-muted">{a.description}</p>}
                  </Card>
                </li>
              );
            })}
          </ul>
        </DataState>
      </section>

      <section aria-labelledby="protection-title" className="space-y-3">
        <h2 id="protection-title" className="text-title">
          Sleep protection windows
        </h2>
        <DataState
          status="empty"
          emptyMessage="No sleep protection windows are scheduled. The schedule source does not provide them yet."
        />
      </section>

      <section aria-labelledby="recent-sleep-title" className="space-y-3">
        <h2 id="recent-sleep-title" className="text-title">
          Recent sleep
        </h2>
        <DataState
          status={statusOf(sleep, nights.length === 0, 'no-data')}
          error={sleep.error}
          onRetry={() => void sleep.refetch()}
          noDataMessage="No data: no sleep has been recorded in the last 7 days."
        >
          <ul className="space-y-2">
            {nights.map((n) => (
              <li key={n.sleep_id}>
                <Card
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4"
                  data-testid="sleep-night"
                >
                  <span className="text-label text-ink">
                    {formatDate(n.sleep_start)}, {formatClock(n.sleep_start)}–
                    {formatClock(n.sleep_end)} UTC
                  </span>
                  <span className="text-sm text-ink">
                    {formatMinutes(n.total_sleep_minutes)} asleep
                  </span>
                  <span className="text-sm text-ink-muted">
                    Efficiency {formatNumber(n.sleep_efficiency_percent, 1)}% · {n.awakenings_count}{' '}
                    awakenings · quality score {formatNumber(n.sleep_quality_score, 1)}
                  </span>
                  <span className="rounded border border-accent/40 px-1.5 py-0.5 text-caption text-accent-strong">
                    Measured
                  </span>
                  {n.quality_status !== 'valid' && (
                    <StatusBadge status="review" label={humanise(n.quality_status)} />
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </DataState>
      </section>
    </div>
  );
}
