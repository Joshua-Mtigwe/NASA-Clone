import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { PlanningTask } from '@/api/types';
import { DataState, PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatClock, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { DayNav } from './DayNav';
import { DemandProfile } from './DemandProfile';
import { usePlannerOverview, usePlanningDay, useTaskSet } from './hooks';
import { TaskForm } from './TaskForm';

export function TaskPoolPage() {
  const day = usePlanningDay();
  const overview = usePlannerOverview(day.date);
  const taskSetId = overview.data?.task_set_id ?? null;
  const set = useTaskSet(taskSetId);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PlanningTask | 'new' | null>(null);

  const tasks = set.data?.tasks ?? [];
  const visible = tasks.filter(
    (t) =>
      (category === 'all' || t.task.task_category === category) &&
      (!query || t.task.task_title.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task Pool"
        description={
          set.data
            ? `${set.data.task_set.scenario_name} · task set ${set.data.task_set.task_set_id}`
            : 'Tasks for the selected day.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DayNav day={day} />
            <Button onClick={() => setEditing('new')} disabled={!set.data}>
              <Plus aria-hidden="true" /> New task
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2" role="search" aria-label="Filter tasks">
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border bg-surface-sunken px-2 text-sm text-ink"
        >
          {['all', 'technical', 'maintenance', 'research', 'medical'].map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All categories' : humanise(c)}
            </option>
          ))}
        </select>
        <input
          aria-label="Search tasks"
          placeholder="Search by title"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 rounded-md border bg-surface-sunken px-3 text-sm text-ink"
        />
      </div>

      <DataState
        status={statusOf(set, visible.length === 0)}
        error={set.error}
        onRetry={() => void set.refetch()}
        emptyMessage="No tasks match."
      >
        <ul className="grid gap-3 lg:grid-cols-2">
          {visible.map((t) => {
            const r = t.requirements[0];
            return (
              <li key={t.task.task_id}>
                <Card className="space-y-3 p-4" data-testid="task-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-medium text-ink">{t.task.task_title}</h2>
                      <p className="text-caption text-ink-subtle">
                        {t.task.task_id} · {humanise(t.task.task_category)} ·{' '}
                        {humanise(t.task.priority)} priority · {t.task.estimated_duration_minutes}{' '}
                        min · crew {t.task.required_crew_count} · due {formatClock(t.task.deadline)}{' '}
                        UTC
                      </p>
                      <p className="text-caption text-ink-subtle">
                        Requires {r?.required_certification || 'no certification'} ·{' '}
                        {r?.safety_classification === 'safety_critical'
                          ? 'Safety-critical'
                          : 'Standard'}{' '}
                        ·{' '}
                        {t.dependencies.length
                          ? `after ${t.dependencies.map((d) => d.depends_on_task_id).join(', ')}`
                          : 'no dependencies'}
                        {t.proposed && ` · ${t.proposed.schedule_flexibility}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(t)}
                      aria-label={`Edit ${t.task.task_title}`}
                    >
                      Edit
                    </Button>
                  </div>
                  <DemandProfile task={t} />
                </Card>
              </li>
            );
          })}
        </ul>
      </DataState>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New task' : 'Edit task'}</DialogTitle>
            <DialogDescription>
              All times are UTC. Demand scores are 0 (none) to 5 (very high).
            </DialogDescription>
          </DialogHeader>
          {editing !== null && set.data && (
            <TaskForm
              taskSet={set.data.task_set}
              tasks={tasks}
              existing={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
