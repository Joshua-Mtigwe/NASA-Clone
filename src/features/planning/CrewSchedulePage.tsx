import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isMockMode } from '@/config/env';
import { planningApi } from '@/api/planning';
import type { PipelineStage, ScheduleIssueKind } from '@/api/types';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatClock, formatMinutes, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { enqueueOverride, flushQueue } from '@/features/assessment/offline/queue';
import { DayNav } from './DayNav';
import {
  useCrew,
  useCrewDays,
  usePlannerOverview,
  usePlanningDay,
  useSchedule,
  useScheduleVersions,
  useTaskSet,
} from './hooks';
import { ScheduleTimeline } from './ScheduleTimeline';

const STAGE_LABEL: Record<PipelineStage, string> = {
  task_interpretation: 'Task interpretation',
  constraint_checks: 'Constraint checks',
  optimisation: 'Optimisation',
  explanation: 'Explanation',
};
const ISSUE_LABEL: Record<ScheduleIssueKind, string> = {
  conflict: 'Conflict',
  missing_qualification: 'Missing qualification',
  unassigned: 'Unassigned task',
};

/** Polling interval for the optimiser pipeline (ms). */
export const PIPELINE_POLL_MS = 300;

function withTime(iso: string, hhmm: string) {
  return `${iso.slice(0, 10)}T${hhmm}:00Z`;
}

export function CrewSchedulePage() {
  const queryClient = useQueryClient();
  const day = usePlanningDay();
  const overview = usePlannerOverview(day.date);
  const taskSetId = overview.data?.task_set_id ?? null;
  const set = useTaskSet(taskSetId);
  const versions = useScheduleVersions(taskSetId);
  const crew = useCrew();
  const crewIds = (crew.data ?? []).map((a) => a.astronaut_id);
  const days = useCrewDays(crewIds, day.date);

  const [versionId, setVersionId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [override, setOverride] = useState({ astronaut: '', start: '', end: '', reason: '' });
  const [confirmed, setConfirmed] = useState<string[]>([]);

  const versionList = useMemo(() => versions.data ?? [], [versions.data]);
  useEffect(() => {
    if (!versionId && versionList.length) setVersionId(versionList[0]!.schedule_version_id);
  }, [versionId, versionList]);
  useEffect(() => {
    setVersionId(null);
    setSelected(null);
  }, [taskSetId]);

  const schedule = useSchedule(versionId);
  const detail = schedule.data;
  const approved = detail?.version.status === 'approved' || detail?.version.status === 'published';

  const pipeline = useQuery({
    queryKey: ['planning', 'optimize', runId],
    queryFn: () => planningApi.optimizeStatus(runId!),
    enabled: !!runId,
    refetchInterval: (q) =>
      ['completed', 'failed'].includes(q.state.data?.run.status ?? '') ? false : PIPELINE_POLL_MS,
  });
  useEffect(() => {
    const done =
      pipeline.data?.run.status === 'completed' ? pipeline.data.schedule_version_id : null;
    if (done && done !== versionId) {
      void queryClient.invalidateQueries({ queryKey: ['planning', 'schedules', taskSetId] });
      setVersionId(done);
    }
  }, [pipeline.data, queryClient, taskSetId, versionId]);

  const generate = useMutation({
    mutationFn: () => planningApi.optimize({ task_set_id: taskSetId! }),
    onSuccess: (run) => setRunId(run.optimization_run_id),
  });

  const explain = useMutation({
    mutationFn: (assignmentId: string) => planningApi.explainAssignment(assignmentId),
  });
  const explanation = explain.data?.entity_id === selected ? explain.data : null;
  const selectedAssignment =
    detail?.assignments.find((a) => a.task_assignment_id === selected) ?? null;
  useEffect(() => {
    if (selectedAssignment) {
      setOverride({
        astronaut: selectedAssignment.astronaut_id,
        start: formatClock(selectedAssignment.planned_start),
        end: formatClock(selectedAssignment.planned_end),
        reason: '',
      });
    }
  }, [selectedAssignment]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['planning'] });
    void queryClient.invalidateQueries({ queryKey: ['astronauts'] });
  };
  const doOverride = useMutation({
    // Saved on this device first, so an override made offline is sent on reconnect.
    // 'always': the offline queue handles connectivity, so the mutation must not pause.
    networkMode: 'always',
    mutationFn: async () => {
      await enqueueOverride(versionId!, {
        task_assignment_id: selected!,
        astronaut_id: override.astronaut,
        planned_start: withTime(selectedAssignment!.planned_start, override.start),
        planned_end: withTime(selectedAssignment!.planned_end, override.end),
        reason: override.reason,
      });
      return flushQueue();
    },
    // Offline: keep showing what we have; the queue sends it on reconnect.
    onSuccess: (result) => {
      if (!result.offline) refresh();
    },
  });
  const approve = useMutation({
    mutationFn: () =>
      planningApi.approveSchedule(versionId!, { confirmed_safety_critical: confirmed }),
    onSuccess: refresh,
  });

  const tasks = useMemo(
    () => new Map((set.data?.tasks ?? []).map((t) => [t.task.task_id, t.task])),
    [set.data],
  );
  const locked = useMemo(
    () => new Map(days.map((d, i) => [crewIds[i]!, d.data?.items ?? []])),
    [days, crewIds],
  );
  const shownCrew = filter === 'all' ? crewIds : [filter];
  const conflicted = new Set(
    (detail?.issues ?? []).filter((i) => i.kind !== 'unassigned').map((i) => i.task_id),
  );
  const rec = selectedAssignment
    ? detail?.recommendations.find(
        (r) => r.recommendation_id === selectedAssignment.recommendation_id,
      )
    : undefined;
  const safety = detail?.safety_critical_task_ids ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Crew Schedule"
        description="Generate, review, adjust and approve the day's plan. Times are UTC."
        actions={<DayNav day={day} />}
      />

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <label className="text-label text-ink-muted" htmlFor="version">
          Schedule version
        </label>
        <select
          id="version"
          value={versionId ?? ''}
          onChange={(e) => setVersionId(e.target.value)}
          className="h-9 rounded-md border bg-surface-sunken px-2 text-sm text-ink"
        >
          {versionList.map((v) => (
            <option key={v.schedule_version_id} value={v.schedule_version_id}>
              Version {v.version_number}{' '}
              {v.version_number === 1 ? '(preloaded draft)' : '(alternative)'} ·{' '}
              {['approved', 'published'].includes(v.status) ? 'approved' : 'draft'}
            </option>
          ))}
        </select>
        <label className="text-label text-ink-muted" htmlFor="crew-filter">
          Astronaut
        </label>
        <select
          id="crew-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 rounded-md border bg-surface-sunken px-2 text-sm text-ink"
        >
          <option value="all">All crew</option>
          {crewIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <Button
          className="ml-auto"
          onClick={() => generate.mutate()}
          disabled={
            !taskSetId ||
            generate.isPending ||
            (!!runId && !['completed', 'failed'].includes(pipeline.data?.run.status ?? ''))
          }
        >
          <Sparkles aria-hidden="true" /> Generate plan
        </Button>
      </Card>

      {runId && pipeline.data && (
        <Card className="p-4" role="region" aria-label="Plan generation">
          <ol className="flex flex-wrap gap-4">
            {pipeline.data.stages.map((s) => (
              <li key={s.stage} data-testid="pipeline-stage" data-status={s.status}>
                <StatusBadge
                  status={
                    s.status === 'completed'
                      ? 'nominal'
                      : s.status === 'failed'
                        ? 'action'
                        : s.status === 'running'
                          ? 'review'
                          : 'no_data'
                  }
                  label={`${STAGE_LABEL[s.stage]}: ${s.status}`}
                />
              </li>
            ))}
          </ol>
        </Card>
      )}

      <DataState
        status={!versionId && !versions.isPending ? 'empty' : statusOf(schedule, !detail)}
        error={schedule.error}
        onRetry={() => void schedule.refetch()}
        emptyMessage="No schedule for this day."
      >
        {detail && (
          <>
            {approved ? (
              <StatusBadge status="nominal" label="Approved and published" />
            ) : (
              <StatusBadge status="review" label="Draft, not approved" />
            )}

            <Card className="p-4">
              <ScheduleTimeline
                crew={shownCrew}
                assignments={detail.assignments}
                tasks={tasks}
                locked={locked}
                selected={selected}
                onSelect={setSelected}
                conflicted={conflicted}
              />
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="space-y-3 p-4" role="region" aria-label="Issues">
                <h2 className="text-title">Issues ({detail.issues.length})</h2>
                {detail.issues.length === 0 ? (
                  <p className="text-ink-muted">
                    No conflicts, missing qualifications or unassigned tasks.
                  </p>
                ) : (
                  <ul className="space-y-2" data-testid="issues">
                    {detail.issues.map((i, n) => (
                      <li key={n} className="text-sm">
                        <StatusBadge
                          status={i.kind === 'unassigned' ? 'action' : 'review'}
                          label={ISSUE_LABEL[i.kind]}
                        />{' '}
                        <span className="text-ink">
                          {tasks.get(i.task_id)?.task_title ?? i.task_id}
                        </span>
                        {i.astronaut_id && (
                          <span className="text-ink-muted"> · {i.astronaut_id}</span>
                        )}
                        <span className="block text-caption text-ink-muted">{i.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="space-y-3 p-4" role="region" aria-label="Duty limits">
                <h2 className="text-title">Duty limits</h2>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    Scheduled task time against each astronaut's workload limit
                  </caption>
                  <thead className="text-label text-ink-muted">
                    <tr>
                      <th scope="col" className="py-1">
                        Astronaut
                      </th>
                      <th scope="col" className="py-1">
                        Scheduled
                      </th>
                      <th scope="col" className="py-1">
                        Limit
                      </th>
                      <th scope="col" className="py-1">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.duty.map((d) => (
                      <tr key={d.astronaut_id} className="border-t" data-testid="duty-row">
                        <td className="py-1">{d.astronaut_id}</td>
                        <td className="py-1">{formatMinutes(d.scheduled_minutes)}</td>
                        <td className="py-1">
                          {d.workload_limit_minutes === null
                            ? 'No data'
                            : formatMinutes(d.workload_limit_minutes)}
                        </td>
                        <td className="py-1">
                          {d.workload_limit_minutes === null ? (
                            <StatusBadge status="no_data" />
                          ) : d.over_limit ? (
                            <StatusBadge status="action" label="Over limit" />
                          ) : (
                            <StatusBadge status="nominal" label="Within limit" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            {selectedAssignment && (
              <Card className="space-y-3 p-4" role="region" aria-label="Selected assignment">
                <h2 className="text-title">
                  {tasks.get(selectedAssignment.task_id)?.task_title ?? selectedAssignment.task_id}
                </h2>
                <p className="text-sm text-ink-muted">
                  {selectedAssignment.astronaut_id} ·{' '}
                  {formatClock(selectedAssignment.planned_start)}–
                  {formatClock(selectedAssignment.planned_end)} UTC ·{' '}
                  {humanise(selectedAssignment.assignment_status)}
                </p>
                <div className="rounded-md border border-accent/30 p-3 text-sm">
                  <p className="text-caption uppercase text-accent-strong">
                    {explanation?.source === 'gemma'
                      ? 'Explanation from Gemma (AI)'
                      : 'Assignment explanation'}
                  </p>
                  <p className="text-ink">
                    {explanation?.text ??
                      rec?.recommendation_reason ??
                      'No explanation was returned for this assignment.'}
                  </p>
                  {rec && (
                    <p className="text-caption text-ink-subtle">
                      Source {explanation?.model_id ?? rec.model_version} · constraint check{' '}
                      {humanise(rec.constraint_check_status)}
                    </p>
                  )}
                </div>
                {!isMockMode && (
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={explain.isPending}
                      onClick={() => explain.mutate(selectedAssignment.task_assignment_id)}
                    >
                      {explain.isPending ? 'Asking Gemma…' : 'Ask Gemma to explain'}
                    </Button>
                    {explanation?.note && (
                      <p role="status" className="text-sm text-ink-muted">
                        {explanation.note}
                      </p>
                    )}
                    {explain.isError && <p role="alert">{explain.error.message}</p>}
                  </div>
                )}
                {!approved && (
                  <form
                    className="grid gap-3 sm:grid-cols-4"
                    aria-label="Manual override"
                    onSubmit={(e) => {
                      e.preventDefault();
                      doOverride.mutate();
                    }}
                  >
                    <label className="space-y-1 text-label text-ink-muted">
                      Astronaut
                      <select
                        value={override.astronaut}
                        onChange={(e) => setOverride((o) => ({ ...o, astronaut: e.target.value }))}
                        className="h-9 w-full rounded-md border bg-surface-sunken px-2 text-sm text-ink"
                      >
                        {crewIds.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-label text-ink-muted">
                      Start (UTC)
                      <input
                        type="time"
                        value={override.start}
                        onChange={(e) => setOverride((o) => ({ ...o, start: e.target.value }))}
                        className="h-9 w-full rounded-md border bg-surface-sunken px-2 text-sm text-ink"
                      />
                    </label>
                    <label className="space-y-1 text-label text-ink-muted">
                      End (UTC)
                      <input
                        type="time"
                        value={override.end}
                        onChange={(e) => setOverride((o) => ({ ...o, end: e.target.value }))}
                        className="h-9 w-full rounded-md border bg-surface-sunken px-2 text-sm text-ink"
                      />
                    </label>
                    <label className="space-y-1 text-label text-ink-muted sm:col-span-4">
                      Reason for override (required)
                      <textarea
                        value={override.reason}
                        onChange={(e) => setOverride((o) => ({ ...o, reason: e.target.value }))}
                        className="h-16 w-full rounded-md border bg-surface-sunken px-2 py-1 text-sm text-ink"
                      />
                    </label>
                    {doOverride.isError && (
                      <p role="alert" className="text-sm text-status-action sm:col-span-4">
                        {doOverride.error.message}
                      </p>
                    )}
                    {doOverride.data?.offline && (
                      <p role="status" className="text-sm text-status-review sm:col-span-4">
                        Saved on this device. The override is sent when the connection returns.
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={!override.reason.trim() || doOverride.isPending}
                      className="sm:col-span-1"
                    >
                      Apply override
                    </Button>
                  </form>
                )}
              </Card>
            )}

            {!approved && (
              <Card className="space-y-3 p-4" role="region" aria-label="Approve and publish">
                <h2 className="text-title">Approve and publish</h2>
                {safety.length > 0 ? (
                  <fieldset className="space-y-1">
                    <legend className="text-sm text-ink">
                      Safety-critical assignments are never applied automatically. Confirm each one:
                    </legend>
                    {safety.map((id) => (
                      <label key={id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={confirmed.includes(id)}
                          onChange={(e) =>
                            setConfirmed((c) =>
                              e.target.checked ? [...c, id] : c.filter((x) => x !== id),
                            )
                          }
                        />
                        {tasks.get(id)?.task_title ?? id}
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p className="text-sm text-ink-muted">
                    No safety-critical assignments in this version.
                  </p>
                )}
                {approve.isError && (
                  <p role="alert" className="text-sm text-status-action">
                    {approve.error.message}
                  </p>
                )}
                <Button
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending || safety.some((id) => !confirmed.includes(id))}
                >
                  Approve and publish
                </Button>
              </Card>
            )}
          </>
        )}
      </DataState>
    </div>
  );
}
