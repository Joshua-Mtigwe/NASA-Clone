import { useQuery } from '@tanstack/react-query';
import {
  BedDouble,
  Brain,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  Leaf,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { recoveryApi } from '@/api/recovery';
import type { ScheduleItem, ScheduleItemKind } from '@/api/types';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatClock, formatDate, formatMinutes, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { cn } from '@/lib/utils';
import { shiftDate } from './config';
import { layoutDay } from './scheduleLayout';
import { useAstronautContext, useSchedule } from './hooks';

const KIND: Record<
  ScheduleItemKind,
  { label: string; icon: LucideIcon; block: string; dot: string }
> = {
  task: {
    label: 'Mission task',
    icon: Wrench,
    block: 'border-cyan-400/60 bg-cyan-500/15 text-cyan-50',
    dot: 'bg-cyan-400',
  },
  assessment: {
    label: 'Cognitive assessment',
    icon: Brain,
    block: 'border-violet-400/60 bg-violet-500/20 text-violet-50',
    dot: 'bg-violet-400',
  },
  exercise: {
    label: 'Exercise',
    icon: Dumbbell,
    block: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-50',
    dot: 'bg-emerald-400',
  },
  sleep: {
    label: 'Sleep',
    icon: BedDouble,
    block: 'border-indigo-400/50 bg-indigo-500/20 text-indigo-50',
    dot: 'bg-indigo-400',
  },
  recovery: {
    label: 'Supportive routine',
    icon: Leaf,
    block: 'border-amber-300/60 bg-amber-400/15 text-amber-50',
    dot: 'bg-amber-300',
  },
};

const HOUR_PX = 56;
const MIN = 60_000;

/** Only an explicit backend "approved" counts as approved. */
function isDraft(item: ScheduleItem): boolean {
  return item.approval_status !== null && item.approval_status !== 'approved';
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption uppercase text-ink-subtle">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

function Timetable({
  items,
  date,
  nowMinutes,
  onOpen,
}: {
  items: ScheduleItem[];
  date: string;
  nowMinutes: number | null;
  onOpen: (item: ScheduleItem) => void;
}) {
  const placed = useMemo(() => layoutDay(items, date), [items, date]);
  const firstHour = Math.min(6, ...placed.map((p) => Math.floor(p.start / 60)));
  const hours = Array.from({ length: 24 - firstHour + 1 }, (_, i) => firstHour + i);
  const top = (minutes: number) => ((minutes - firstHour * 60) / 60) * HOUR_PX;
  const scroller = useRef<HTMLDivElement>(null);

  // Open on the first activity of the day.
  useEffect(() => {
    const first = placed[0];
    if (scroller.current && first) scroller.current.scrollTop = Math.max(0, top(first.start) - 24);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, placed.length]);

  return (
    <div
      ref={scroller}
      className="max-h-[70vh] overflow-y-auto rounded-xl border border-white/[0.06] bg-navy-950/50"
      data-testid="timetable"
    >
      <div className="relative" style={{ height: (hours.length - 1) * HOUR_PX + 16 }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute inset-x-0 flex items-start"
            style={{ top: top(h * 60) }}
            aria-hidden="true"
          >
            <span className="w-16 -translate-y-2 pr-2 text-right font-mono text-caption text-ink-subtle">
              {String(h % 24).padStart(2, '0')}:00
            </span>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>
        ))}

        {nowMinutes !== null && nowMinutes >= firstHour * 60 && (
          <div
            className="absolute left-16 right-2 z-20 flex items-center"
            style={{ top: top(nowMinutes) }}
            aria-hidden="true"
          >
            <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-status-action" />
            <span className="h-0.5 flex-1 bg-status-action/80" />
          </div>
        )}

        <ol className="absolute bottom-0 left-16 right-2 top-0" aria-label="Activities">
          {placed.map((p) => {
            const kind = KIND[p.item.kind];
            const Icon = kind.icon;
            const height = Math.max(((p.end - p.start) / 60) * HOUR_PX - 3, 22);
            const compact = height < 44;
            const end = p.item.end_time ?? null;
            const label = `${kind.label}: ${humanise(p.item.title)}, ${formatClock(p.item.start_time)}${end ? ` to ${formatClock(end)}` : ''} UTC`;
            return (
              <li
                key={`${p.item.kind}-${p.item.ref_id}`}
                className="absolute px-0.5"
                style={{
                  top: top(p.start) + 1,
                  height,
                  left: `${(p.column / p.columns) * 100}%`,
                  width: `${100 / p.columns}%`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(p.item)}
                  aria-label={label}
                  data-testid="schedule-item"
                  data-kind={p.item.kind}
                  className={cn(
                    'flex h-full w-full flex-col overflow-hidden rounded-lg border-l-[3px] px-2.5 py-1 text-left shadow-sm transition duration-150 hover:brightness-125 focus-visible:z-10',
                    kind.block,
                    isDraft(p.item) && 'border-dashed opacity-80',
                  )}
                >
                  <span className="flex items-center gap-1.5 truncate text-label font-medium">
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{humanise(p.item.title)}</span>
                  </span>
                  {!compact && (
                    <span className="truncate text-caption opacity-80">
                      {formatClock(p.item.start_time)}
                      {end ? `–${formatClock(end)}` : ''}
                      {p.continues ? ' (continues)' : ''}
                      {isDraft(p.item) ? ' · draft' : ''}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function RecommendedRoutines({
  astronautId,
  date,
}: {
  astronautId: string | null;
  date: string | null;
}) {
  const published = useQuery({
    queryKey: ['recovery', astronautId, 'published', date],
    queryFn: () => recoveryApi.published({ astronaut_id: astronautId!, date: date! }),
    enabled: !!astronautId && !!date,
  });
  const rows = published.data ?? [];
  return (
    <section aria-labelledby="routine-title" className="space-y-3">
      <h2 id="routine-title" className="flex items-center gap-2 text-title">
        <Leaf className="h-5 w-5 text-amber-300" aria-hidden="true" />
        Recommended Supportive Routine
      </h2>
      <DataState
        status={statusOf(published, rows.length === 0)}
        error={published.error}
        onRetry={() => void published.refetch()}
        emptyMessage="Your mission planning leader has not published a supportive routine for this day."
      >
        <ul className="grid gap-3 md:grid-cols-2" data-testid="published-routines">
          {rows.map((r) => (
            <li
              key={r.schedule_id}
              className="surface-glass relative overflow-hidden border-amber-300/20 p-4"
              data-testid="published-routine"
            >
              <div
                className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-300 to-amber-500"
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium text-ink">
                    {r.activity?.activity_name ?? 'Supportive routine'}
                  </h3>
                  <p className="text-caption text-ink-subtle">
                    {r.activity
                      ? `${humanise(r.activity.activity_category)} · ${humanise(r.activity.intensity)} intensity`
                      : 'Details unavailable'}
                  </p>
                </div>
                <StatusBadge status="nominal" label="Published by mission planning" />
              </div>
              <p className="mt-2 flex items-center gap-2 text-sm text-ink">
                <Clock3 className="h-4 w-4 text-ink-muted" aria-hidden="true" />
                {formatClock(r.scheduled_start)}–{formatClock(r.scheduled_end)} UTC ·{' '}
                {formatMinutes(
                  Math.round((Date.parse(r.scheduled_end) - Date.parse(r.scheduled_start)) / MIN),
                )}
              </p>
              {r.activity?.description && (
                <p className="mt-1 text-sm text-ink-muted">{r.activity.description}</p>
              )}
              {r.activity?.instructions && (
                <p className="mt-1 text-caption text-ink-subtle">
                  Instructions: {humanise(r.activity.instructions)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </DataState>
    </section>
  );
}

export function SchedulePage() {
  const { astronautId, missionDate, missionTime } = useAstronautContext();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<ScheduleItem | null>(null);
  const date = missionDate ? shiftDate(missionDate, offset) : null;
  const schedule = useSchedule(astronautId, date);
  // Unpublished routine recommendations are not part of the astronaut's day.
  const items = (schedule.data?.items ?? []).filter(
    (i) => !(i.kind === 'recovery' && i.approval_status !== 'approved'),
  );
  const nowMinutes =
    offset === 0 && missionTime && date
      ? (Date.parse(missionTime) - Date.parse(`${date}T00:00:00Z`)) / MIN
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Schedule"
        description="Your day as a timetable. Times are UTC."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setOffset((o) => o - 1)}
              aria-label="Previous day"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(0)}
              disabled={offset === 0}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setOffset((o) => o + 1)}
              aria-label="Next day"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-3" aria-live="polite">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-muted/40 text-accent">
          <CalendarDays className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-heading text-ink" data-testid="schedule-date">
            {date ? formatDate(date) : '—'}
          </p>
          <p className="text-caption text-ink-subtle">
            {offset === 0 ? 'Today' : offset > 0 ? `In ${offset} day(s)` : `${-offset} day(s) ago`}
          </p>
        </div>
      </div>

      <RecommendedRoutines astronautId={astronautId} date={date} />

      <section aria-labelledby="timetable-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="timetable-title" className="text-title">
            Timetable
          </h2>
          <ul className="flex flex-wrap gap-3 text-caption text-ink-muted" aria-label="Legend">
            {Object.entries(KIND).map(([k, v]) => (
              <li key={k} className="inline-flex items-center gap-1.5">
                <span className={cn('h-2.5 w-2.5 rounded-full', v.dot)} aria-hidden="true" />
                {v.label}
              </li>
            ))}
          </ul>
        </div>
        <DataState
          status={statusOf(schedule, items.length === 0)}
          error={schedule.error}
          onRetry={() => void schedule.refetch()}
          emptyMessage="Nothing is scheduled for this day."
        >
          {date && <Timetable items={items} date={date} nowMinutes={nowMinutes} onOpen={setOpen} />}
        </DataState>
        <p className="text-caption text-ink-subtle">
          Select an activity for its details. Meals and breaks are not yet provided by the schedule
          source, so they are not listed.
        </p>
      </section>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{humanise(open.title)}</DialogTitle>
                <DialogDescription>{KIND[open.kind].label}</DialogDescription>
              </DialogHeader>
              {isDraft(open) && <StatusBadge status="review" label="Draft, not approved" />}
              <dl className="grid grid-cols-2 gap-4">
                <Detail
                  label="Time"
                  value={`${formatClock(open.start_time)}${open.end_time ? `–${formatClock(open.end_time)}` : ''} UTC`}
                />
                <Detail
                  label="Duration"
                  value={
                    open.duration_minutes === null
                      ? 'Not set'
                      : formatMinutes(open.duration_minutes)
                  }
                />
                <Detail
                  label="Priority"
                  value={open.priority ? humanise(open.priority) : 'Not set'}
                />
                <Detail
                  label="Workload category"
                  value={open.workload_category ? humanise(open.workload_category) : 'Not set'}
                />
                <Detail
                  label="Status"
                  value={open.completion_status ? humanise(open.completion_status) : 'Not recorded'}
                />
                <Detail
                  label="Approval"
                  value={open.approval_status ? humanise(open.approval_status) : 'Not applicable'}
                />
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
