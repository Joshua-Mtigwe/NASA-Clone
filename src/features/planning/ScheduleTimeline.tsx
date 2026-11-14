import { Lock } from 'lucide-react';
import type { ScheduleItem } from '@/api/types';
import type { MissionTasksRow, TaskAssignmentsRow } from '@/types/tables';
import { formatClock, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';

const START_H = 6;
const END_H = 22;
const SPAN = (END_H - START_H) * 60;
const TICKS = [6, 8, 10, 12, 14, 16, 18, 20, 22];

/** Minutes past START_H on the bar's own day (layout only). */
function offset(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes() - START_H * 60;
}

function place(start: string, end: string | null) {
  const s = Math.max(0, offset(start));
  const e = Math.min(SPAN, end ? offset(end) : s + 15);
  return { left: `${(s / SPAN) * 100}%`, width: `${(Math.max(e - s, 4) / SPAN) * 100}%` };
}

const LOCKED_KINDS = new Set(['sleep', 'exercise', 'assessment', 'recovery']);

/** One row per astronaut: task bars plus locked blocks (sleep, exercise, assessments, routines). */
export function ScheduleTimeline({
  crew,
  assignments,
  tasks,
  locked,
  selected,
  onSelect,
  conflicted,
}: {
  crew: string[];
  assignments: TaskAssignmentsRow[];
  tasks: Map<string, MissionTasksRow>;
  locked: Map<string, ScheduleItem[]>;
  selected: string | null;
  onSelect: (id: string) => void;
  conflicted: Set<string>;
}) {
  return (
    <div className="overflow-x-auto" data-testid="schedule-timeline">
      <div className="min-w-[48rem] space-y-2">
        <div className="ml-24 flex justify-between text-caption text-ink-subtle" aria-hidden="true">
          {TICKS.map((h) => (
            <span key={h}>{String(h).padStart(2, '0')}:00</span>
          ))}
        </div>
        {crew.map((id) => (
          <div
            key={id}
            className="flex items-center gap-2"
            role="group"
            aria-label={`${id} timeline`}
            data-testid="timeline-row"
          >
            <span className="shrink-0 text-label text-ink" style={{ width: '5.5rem' }}>
              {id}
            </span>
            <div className="relative h-12 flex-1 rounded-md bg-navy-850">
              {(locked.get(id) ?? [])
                .filter((b) => LOCKED_KINDS.has(b.kind) && b.kind !== 'sleep')
                .map((b) => (
                  <span
                    key={`${b.kind}-${b.ref_id}`}
                    className="absolute inset-y-1 flex items-center gap-1 overflow-hidden rounded border border-dashed border-ink-subtle/50 bg-navy-700/70 px-1 text-caption text-ink-muted"
                    style={place(b.start_time, b.end_time)}
                    title={`Locked: ${humanise(b.title)} ${formatClock(b.start_time)}${b.end_time ? `–${formatClock(b.end_time)}` : ''}`}
                    data-testid="locked-block"
                  >
                    <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{humanise(b.kind)}</span>
                  </span>
                ))}
              {assignments
                .filter((a) => a.astronaut_id === id)
                .map((a) => {
                  const task = tasks.get(a.task_id);
                  const label = `${task?.task_title ?? a.task_id}, ${formatClock(a.planned_start)}–${formatClock(a.planned_end)} UTC`;
                  return (
                    <button
                      key={a.task_assignment_id}
                      type="button"
                      onClick={() => onSelect(a.task_assignment_id)}
                      aria-pressed={selected === a.task_assignment_id}
                      aria-label={label}
                      title={label}
                      className={cn(
                        'absolute inset-y-1 overflow-hidden rounded px-1 text-left text-caption font-medium text-accent-foreground',
                        selected === a.task_assignment_id ? 'ring-2 ring-ink' : '',
                        conflicted.has(a.task_id) ? 'bg-status-review' : 'bg-accent',
                      )}
                      style={place(a.planned_start, a.planned_end)}
                      data-testid="task-bar"
                    >
                      <span className="block truncate">{task?.task_title ?? a.task_id}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
        <p className="flex flex-wrap gap-4 text-caption text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded bg-accent" aria-hidden="true" /> Task
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded bg-status-review" aria-hidden="true" />{' '}
            Task with an issue
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" aria-hidden="true" /> Locked: exercise, assessments,
            supportive routines (sleep is outside 06:00–22:00)
          </span>
        </p>
      </div>
    </div>
  );
}
