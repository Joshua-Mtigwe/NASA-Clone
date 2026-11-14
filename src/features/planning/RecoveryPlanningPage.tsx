import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CheckCircle2, CircleDot, Send, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { recoveryApi } from '@/api/recovery';
import type { RoutinePublicationState } from '@/api/types';
import type { RecoveryRecommendationsRow } from '@/types/tables';
import { DataState, PageHeader, StatusBadge, type Status } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { shiftDate } from '@/features/health/config';
import { useRecoveryCatalogue } from '@/features/health/hooks';
import { useMissionState } from '@/features/shell/useMissionState';
import { formatClock, formatDate, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { useCrew } from './hooks';

const STATE: Record<RoutinePublicationState, { status: Status; label: string }> = {
  recommended: { status: 'no_data', label: 'Recommended' },
  ready_to_publish: { status: 'nominal', label: 'Ready to publish' },
  published: { status: 'nominal', label: 'Published' },
  unable_to_schedule: { status: 'action', label: 'Unable to schedule' },
};

const field = 'h-9 rounded-md border bg-surface-sunken px-2 text-sm text-ink';

function ReviewPanel({
  rec,
  date,
  onPublished,
}: {
  rec: RecoveryRecommendationsRow;
  date: string;
  onPublished: () => void;
}) {
  const queryClient = useQueryClient();
  // Until the leader picks a time, the backend proposes the slot (the recommendation's draft time).
  const [time, setTime] = useState<string | null>(null);
  const start = time ? `${date}T${time}:00Z` : undefined;

  const check = useQuery({
    queryKey: ['recovery', 'publish-check', rec.recommendation_id, start ?? 'default'],
    queryFn: () =>
      recoveryApi.publish(rec.recommendation_id, { scheduled_start: start, dry_run: true }),
    staleTime: 0,
  });
  const c = check.data;
  useEffect(() => {
    if (c && time === null) setTime(formatClock(c.scheduled_start));
  }, [c, time]);

  const publish = useMutation({
    mutationFn: () =>
      recoveryApi.publish(rec.recommendation_id, { scheduled_start: start ?? c!.scheduled_start }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recovery'] });
      void queryClient.invalidateQueries({ queryKey: ['astronauts'] });
      onPublished();
    },
  });

  const published = c?.state === 'published' || publish.data?.state === 'published';
  const shown = publish.data ?? c;

  return (
    <div
      className="mt-3 space-y-3 rounded-lg border border-accent/20 bg-navy-900/60 p-4"
      data-testid="review-panel"
    >
      <DataState
        status={statusOf(check, !c)}
        error={check.error}
        onRetry={() => void check.refetch()}
      >
        {shown && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 text-sm">
                <p className="text-ink">{shown.activity.description}</p>
                <p className="text-caption text-ink-subtle">
                  Instructions: {humanise(shown.activity.instructions)} ·{' '}
                  {humanise(shown.activity.intensity)} intensity
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-label text-ink-muted">
                  Start (UTC) on {formatDate(date)}
                  <input
                    type="time"
                    value={time ?? ''}
                    onChange={(e) => setTime(e.target.value)}
                    disabled={published}
                    className={`${field} block`}
                  />
                </label>
                <p className="text-sm text-ink-muted">
                  {formatClock(shown.scheduled_start)}–{formatClock(shown.scheduled_end)} UTC ·{' '}
                  {shown.duration_minutes} min
                </p>
              </div>
            </div>

            <StatusBadge status={STATE[shown.state].status} label={STATE[shown.state].label} />
            {shown.reasons.length > 0 && (
              <ul className="space-y-1 text-sm text-ink" data-testid="publish-reasons">
                {shown.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <TriangleAlert
                      className="mt-0.5 h-4 w-4 shrink-0 text-status-action"
                      aria-hidden="true"
                    />
                    {r}
                  </li>
                ))}
              </ul>
            )}
            {shown.conflicts.length > 0 && (
              <ul className="space-y-1 text-caption text-ink-muted">
                {shown.conflicts.map((x) => (
                  <li key={`${x.kind}-${x.start_time}-${x.title}`}>
                    Overlaps {humanise(x.kind).toLowerCase()} “{humanise(x.title)}”{' '}
                    {formatClock(x.start_time)}
                    {x.end_time ? `–${formatClock(x.end_time)}` : ''} UTC
                  </li>
                ))}
              </ul>
            )}
            {publish.isError && (
              <p role="alert" className="text-sm text-status-action">
                {publish.error.message}
              </p>
            )}
            {published ? (
              <p role="status" className="flex items-center gap-2 text-sm text-status-nominal">
                <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
                Published to {rec.astronaut_id}&apos;s schedule.
              </p>
            ) : (
              <Button
                onClick={() => publish.mutate()}
                disabled={
                  shown.state !== 'ready_to_publish' || publish.isPending || check.isFetching
                }
              >
                <Send aria-hidden="true" />
                {publish.isPending ? 'Publishing…' : 'Publish to Astronaut Schedule'}
              </Button>
            )}
          </>
        )}
      </DataState>
    </div>
  );
}

export function RecoveryPlanningPage() {
  const mission = useMissionState();
  const crew = useCrew();
  const catalogue = useRecoveryCatalogue();
  const [astronaut, setAstronaut] = useState<string>('');
  const [dayOffset, setDayOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const currentDay = mission.data?.mission_day ?? 1;
  const length = mission.data?.mission_length_days ?? 90;
  const missionDay = Math.min(currentDay + dayOffset, length);
  const launch = mission.data?.mission.launch_date.slice(0, 10) ?? null;
  const date = launch ? shiftDate(launch, missionDay - 1) : null;
  const selected = astronaut || crew.data?.[0]?.astronaut_id || '';

  const recommend = useMutation({
    mutationFn: () => recoveryApi.recommend({ astronaut_id: selected, mission_day: missionDay }),
  });
  const activities = new Map((catalogue.data ?? []).map((a) => [a.recovery_activity_id, a]));
  const [publishedIds, setPublishedIds] = useState<string[]>([]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recovery Planning"
        description="Review recommended supportive routines and publish them directly to an astronaut's schedule."
      />

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="space-y-1 text-label text-ink-muted">
          Astronaut
          <select
            value={selected}
            onChange={(e) => {
              setAstronaut(e.target.value);
              recommend.reset();
              setOpen(null);
            }}
            className={`${field} block w-full`}
          >
            {(crew.data ?? []).map((a) => (
              <option key={a.astronaut_id} value={a.astronaut_id}>
                {a.astronaut_code}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-label text-ink-muted">
          Mission day
          <select
            value={dayOffset}
            onChange={(e) => {
              setDayOffset(Number(e.target.value));
              recommend.reset();
              setOpen(null);
            }}
            className={`${field} block w-full`}
          >
            {[0, 1, 2, 3, 4, 5, 6]
              .filter((o) => currentDay + o <= length)
              .map((o) => (
                <option key={o} value={o}>
                  Day {currentDay + o}
                  {o === 0 ? ' (today)' : ''}
                </option>
              ))}
          </select>
        </label>
        <Button onClick={() => recommend.mutate()} disabled={!selected || recommend.isPending}>
          Get recommendations
        </Button>
      </Card>

      {(recommend.isPending || recommend.isError || recommend.data) && (
        <section aria-labelledby="rec-title" className="space-y-3">
          <h2 id="rec-title" className="text-title">
            Recommended supportive routines
          </h2>
          <p className="text-sm text-ink-muted">
            Recommendations are ranked by the backend rules. Nothing reaches the astronaut until you
            review a routine and publish it.
          </p>
          <DataState
            status={statusOf(recommend, (recommend.data ?? []).length === 0)}
            error={recommend.error}
            emptyMessage="No supportive routines are recommended for this day."
          >
            <ol className="space-y-2" data-testid="recommendations">
              {(recommend.data ?? []).map((r, i) => {
                const a = activities.get(r.recovery_activity_id);
                const isPublished =
                  r.approval_status === 'published' || publishedIds.includes(r.recommendation_id);
                const state: RoutinePublicationState = isPublished ? 'published' : 'recommended';
                return (
                  <li key={r.recommendation_id}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-label text-ink-subtle">#{i + 1}</span>
                        <span className="font-medium text-ink">
                          {a?.activity_name ?? r.recovery_activity_id}
                        </span>
                        <span className="text-sm text-ink-muted">
                          {a
                            ? `${humanise(a.activity_category)} · ${a.recommended_duration_minutes} min`
                            : ''}
                        </span>
                        <span className="ml-auto inline-flex items-center gap-1.5">
                          {isPublished ? (
                            <CheckCircle2
                              className="h-4 w-4 text-status-nominal"
                              aria-hidden="true"
                            />
                          ) : (
                            <CircleDot className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                          )}
                          <StatusBadge status={STATE[state].status} label={STATE[state].label} />
                        </span>
                        <span className="w-full text-caption text-ink-muted">
                          Reason: {r.reason} · {r.algorithm_version} · score{' '}
                          {r.recommendation_score}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        aria-expanded={open === r.recommendation_id}
                        onClick={() =>
                          setOpen(open === r.recommendation_id ? null : r.recommendation_id)
                        }
                      >
                        {open === r.recommendation_id ? 'Close review' : 'Review and publish'}
                      </Button>
                      {open === r.recommendation_id && date && (
                        <ReviewPanel
                          rec={r}
                          date={date}
                          onPublished={() =>
                            setPublishedIds((ids) => [...ids, r.recommendation_id])
                          }
                        />
                      )}
                    </Card>
                  </li>
                );
              })}
            </ol>
          </DataState>
        </section>
      )}

      <section aria-labelledby="catalogue-title" className="space-y-3">
        <h2 id="catalogue-title" className="text-title">
          Catalogue
        </h2>
        <DataState
          status={statusOf(catalogue, (catalogue.data ?? []).length === 0)}
          error={catalogue.error}
        >
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(catalogue.data ?? []).map((a) => (
              <li key={a.recovery_activity_id}>
                <Card className="space-y-1 p-4" data-testid="catalogue-item">
                  <p className="font-medium text-ink">{a.activity_name}</p>
                  <p className="text-caption text-ink-subtle">
                    {humanise(a.activity_category)} · {a.recommended_duration_minutes} min ·{' '}
                    {humanise(a.intensity)} intensity
                  </p>
                  <p className="text-sm text-ink-muted">{a.description}</p>
                </Card>
              </li>
            ))}
          </ul>
        </DataState>
      </section>
    </div>
  );
}
