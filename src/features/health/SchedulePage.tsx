import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ScheduleItem, ScheduleItemKind } from '@/api/types';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatClock, formatDate, formatMinutes, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { shiftDate } from './config';
import { useAstronautContext, useSchedule } from './hooks';

const KIND_LABEL: Record<ScheduleItemKind, string> = {
  task: 'Task',
  recovery: 'Supportive routine',
  assessment: 'Assessment',
  exercise: 'Exercise',
  sleep: 'Sleep',
};

/** Only an explicit backend "approved" counts as approved. */
function isDraft(item: ScheduleItem): boolean {
  return item.approval_status !== null && item.approval_status !== 'approved';
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-ink-subtle">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  return (
    <Card className="p-4" data-testid="schedule-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-caption uppercase text-ink-subtle">{KIND_LABEL[item.kind]}</p>
          <h3 className="font-medium text-ink">{humanise(item.title)}</h3>
        </div>
        {isDraft(item) && <StatusBadge status="review" label="Draft, not approved" />}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field
          label="Start"
          value={`${formatClock(item.start_time)}${item.end_time ? `–${formatClock(item.end_time)}` : ''} UTC`}
        />
        <Field
          label="Duration"
          value={item.duration_minutes === null ? 'Not set' : formatMinutes(item.duration_minutes)}
        />
        <Field label="Priority" value={item.priority ? humanise(item.priority) : 'Not set'} />
        <Field
          label="Workload category"
          value={item.workload_category ? humanise(item.workload_category) : 'Not set'}
        />
        <Field
          label="Status"
          value={item.completion_status ? humanise(item.completion_status) : 'Not recorded'}
        />
      </dl>
    </Card>
  );
}

export function SchedulePage() {
  const { astronautId, missionDate } = useAstronautContext();
  const [offset, setOffset] = useState(0);
  const date = missionDate ? shiftDate(missionDate, offset) : null;
  const schedule = useSchedule(astronautId, date);
  const items = schedule.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Schedule"
        description="Tasks, assessments, exercise, supportive routines and sleep. Times are UTC."
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
            <span
              className="min-w-28 text-center text-label text-ink"
              aria-live="polite"
              data-testid="schedule-date"
            >
              {date ? formatDate(date) : '—'}
              {offset === 0 && <span className="block text-caption text-ink-subtle">Today</span>}
            </span>
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

      <DataState
        status={statusOf(schedule, items.length === 0)}
        error={schedule.error}
        onRetry={() => void schedule.refetch()}
        emptyMessage="Nothing is scheduled for this day."
      >
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.kind}-${item.ref_id}`}>
              <ScheduleRow item={item} />
            </li>
          ))}
        </ul>
      </DataState>
      <p className="text-caption text-ink-subtle">
        Meals and breaks are not yet provided by the schedule source, so they are not listed.
      </p>
    </div>
  );
}
