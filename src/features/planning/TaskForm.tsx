import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { planningApi } from '@/api/planning';
import type { PlanningTask, PlanningTaskInput } from '@/api/types';
import type { DailyTaskSetsRow } from '@/types/tables';
import { isApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { demandValues } from './demand';

const CATEGORIES = ['technical', 'maintenance', 'research', 'medical'];
const PRIORITIES = ['low', 'medium', 'high'];
const CERTIFICATIONS = [
  '',
  'SIM_CERT_SYSTEMS',
  'SIM_CERT_SCIENCE',
  'SIM_CERT_FLIGHT',
  'SIM_CERT_MEDICAL',
  'SIM_CERT_ENGINEERING',
];
const field = 'h-10 w-full rounded-md border bg-surface-sunken px-3 text-sm text-ink';

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-label text-ink-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-caption text-ink-subtle">{hint}</p>}
    </div>
  );
}

function Score({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={`${label} (0–5)`}>
      {(id) => (
        <input
          id={id}
          type="number"
          min={0}
          max={5}
          step={1}
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value))}
          className={field}
        />
      )}
    </Field>
  );
}

/** Create or edit a task with every blueprint field. Fields with no CSV column are sent as proposed fields. */
export function TaskForm({
  taskSet,
  tasks,
  existing,
  onDone,
}: {
  taskSet: DailyTaskSetsRow;
  tasks: PlanningTask[];
  existing: PlanningTask | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const t = existing?.task;
  const r = existing?.requirements[0];
  const d = existing ? demandValues(existing) : null;
  const [v, setV] = useState({
    title: t?.task_title ?? '',
    description: t?.task_description ?? '',
    category: t?.task_category ?? 'technical',
    priority: t?.priority ?? 'medium',
    duration: t?.estimated_duration_minutes ?? 30,
    crew: t?.required_crew_count ?? 1,
    deadline: t?.deadline.slice(11, 16) ?? '18:00',
    certification: r?.required_certification ?? '',
    specialization: r?.required_specialization ?? '',
    safety: r?.safety_classification ?? 'standard_demo',
    physical: r?.physical_demand_score ?? 0,
    cognitive: r?.cognitive_demand_score ?? 0,
    attention: d?.attention ?? 0,
    timePressure: d?.time_pressure ?? 0,
    workingMemory: d?.working_memory ?? null,
    procedural: d?.procedural ?? null,
    dependencies: existing?.dependencies.map((x) => x.depends_on_task_id) ?? [],
    equipment: existing?.proposed?.equipment_and_location ?? '',
    constraints: existing?.proposed?.scheduling_constraints ?? '',
    flexibility: existing?.proposed?.schedule_flexibility ?? 'flexible',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) =>
    setV((s) => ({ ...s, [k]: value }));

  const save = useMutation({
    mutationFn: (body: PlanningTaskInput) =>
      existing ? planningApi.updateTask(existing.task.task_id, body) : planningApi.createTask(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['planning'] });
      onDone();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      task: {
        mission_id: taskSet.mission_id,
        task_set_id: taskSet.task_set_id,
        task_date: taskSet.task_date,
        task_title: v.title.trim(),
        task_description: v.description,
        task_category: v.category,
        priority: v.priority,
        estimated_duration_minutes: v.duration,
        required_crew_count: v.crew,
        deadline: `${taskSet.task_date}T${v.deadline}:00Z`,
        task_status: t?.task_status ?? 'prepared',
      },
      requirements: {
        required_specialization: v.specialization,
        required_certification: v.certification,
        cognitive_demand_score: v.cognitive,
        physical_demand_score: v.physical,
        attention_demand_score: v.attention,
        time_pressure_score: v.timePressure,
        safety_classification: v.safety,
        review_status: 'leader_reviewed',
      },
      depends_on_task_ids: v.dependencies,
      proposed: {
        working_memory_demand_score: v.workingMemory,
        procedural_complexity_score: v.procedural,
        equipment_and_location: v.equipment,
        scheduling_constraints: v.constraints,
        schedule_flexibility: v.flexibility,
      },
    });
  };

  const fieldErrors = isApiError(save.error) ? save.error.fieldErrors : [];
  const others = tasks.filter((x) => x.task.task_id !== existing?.task.task_id);

  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-label={existing ? 'Edit task' : 'New task'}
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          {(id) => (
            <input
              id={id}
              value={v.title}
              onChange={(e) => set('title', e.target.value)}
              className={field}
              required
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              value={v.category}
              onChange={(e) => set('category', e.target.value)}
              className={field}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            {(id) => (
              <textarea
                id={id}
                value={v.description}
                onChange={(e) => set('description', e.target.value)}
                className={`${field} h-20 py-2`}
              />
            )}
          </Field>
        </div>
        <Field label="Priority">
          {(id) => (
            <select
              id={id}
              value={v.priority}
              onChange={(e) => set('priority', e.target.value)}
              className={field}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Duration (minutes)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              value={v.duration}
              onChange={(e) => set('duration', Number(e.target.value))}
              className={field}
            />
          )}
        </Field>
        <Score label="Physical workload" value={v.physical} onChange={(n) => set('physical', n)} />
        <Score
          label="Cognitive workload"
          value={v.cognitive}
          onChange={(n) => set('cognitive', n)}
        />
        <Field label="Required qualification">
          {(id) => (
            <select
              id={id}
              value={v.certification}
              onChange={(e) => set('certification', e.target.value)}
              className={field}
            >
              {CERTIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c || 'None'}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Crew required">
          {(id) => (
            <input
              id={id}
              type="number"
              min={1}
              max={5}
              value={v.crew}
              onChange={(e) => set('crew', Number(e.target.value))}
              className={field}
            />
          )}
        </Field>
        <Field label="Deadline (UTC)">
          {(id) => (
            <input
              id={id}
              type="time"
              value={v.deadline}
              onChange={(e) => set('deadline', e.target.value)}
              className={field}
            />
          )}
        </Field>
        <Field label="Safety classification">
          {(id) => (
            <select
              id={id}
              value={v.safety}
              onChange={(e) => set('safety', e.target.value)}
              className={field}
            >
              <option value="standard_demo">Standard</option>
              <option value="safety_critical">Safety-critical</option>
            </select>
          )}
        </Field>
        <Field label="Equipment and location" hint="Proposed field (no CSV column yet).">
          {(id) => (
            <input
              id={id}
              value={v.equipment}
              onChange={(e) => set('equipment', e.target.value)}
              className={field}
            />
          )}
        </Field>
        <Field label="Scheduling constraints" hint="Proposed field (no CSV column yet).">
          {(id) => (
            <input
              id={id}
              value={v.constraints}
              onChange={(e) => set('constraints', e.target.value)}
              className={field}
            />
          )}
        </Field>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-label text-ink-muted">Fixed or flexible</legend>
        <div className="flex gap-4 text-sm">
          {(['fixed', 'flexible'] as const).map((f) => (
            <label key={f} className="flex items-center gap-2">
              <input
                type="radio"
                name="flexibility"
                checked={v.flexibility === f}
                onChange={() => set('flexibility', f)}
              />
              {f === 'fixed' ? 'Fixed time' : 'Flexible'}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-label text-ink-muted">Dependencies (must finish first)</legend>
        <div className="grid max-h-32 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
          {others.map((o) => (
            <label key={o.task.task_id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={v.dependencies.includes(o.task.task_id)}
                onChange={(e) =>
                  set(
                    'dependencies',
                    e.target.checked
                      ? [...v.dependencies, o.task.task_id]
                      : v.dependencies.filter((x) => x !== o.task.task_id),
                  )
                }
              />
              {o.task.task_title}{' '}
              <span className="text-caption text-ink-subtle">({o.task.task_id})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-md border p-3">
        <legend className="px-1 text-label text-ink-muted">
          Demand profile (AI proposal, editable)
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Score
            label="Sustained attention"
            value={v.attention}
            onChange={(n) => set('attention', n)}
          />
          <Score
            label="Working memory"
            value={v.workingMemory}
            onChange={(n) => set('workingMemory', n)}
          />
          <Score
            label="Time pressure"
            value={v.timePressure}
            onChange={(n) => set('timePressure', n)}
          />
          <Score
            label="Procedural complexity"
            value={v.procedural}
            onChange={(n) => set('procedural', n)}
          />
        </div>
      </fieldset>

      {save.isError && (
        <div role="alert" className="text-sm text-status-action">
          {fieldErrors.length
            ? fieldErrors.map((f) => <p key={f.field}>{f.message}</p>)
            : save.error.message}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : existing ? 'Save task' : 'Create task'}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
