import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Zap } from 'lucide-react';
import { useState } from 'react';
import { missionsApi } from '@/api/missions';
import { simulationApi } from '@/api/simulation';
import { queryKeys } from '@/app/queryClient';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useOutboxStatus } from '@/features/assessment/offline/queue';
import { useUi } from '@/features/shell/uiStore';
import { useMissionState } from '@/features/shell/useMissionState';
import { formatTimestamp, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { DemoStoryControl } from './DemoStoryControl';

const field = 'h-9 rounded-md border bg-surface-sunken px-2 text-sm text-ink';

function useRuns() {
  return useQuery({ queryKey: ['simulation', 'runs'], queryFn: () => simulationApi.listRuns() });
}

function Detail({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-caption uppercase text-ink-subtle">{label}</dt>
      <dd className="text-ink" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

// ---------------- Mission State ----------------

export function MissionStatePage() {
  const mission = useMissionState();
  const realtime = useUi((s) => s.realtimeStatus);
  const s = mission.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mission State"
        description="The mission clock and simulation the whole application is running against."
      />
      <DataState
        status={statusOf(mission, !s)}
        error={mission.error}
        onRetry={() => void mission.refetch()}
      >
        {s && (
          <Card className="p-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail
                label="Mission"
                value={`${s.mission.mission_name} (${humanise(s.mission.mission_status)})`}
              />
              <Detail
                label="Mission day"
                value={`Day ${s.mission_day} / ${s.mission_length_days}`}
                testId="state-day"
              />
              <Detail
                label="Mission clock"
                value={formatTimestamp(s.mission_time)}
                testId="state-clock"
              />
              <Detail
                label="Simulation run"
                value={
                  s.simulation_run
                    ? `${s.simulation_run.run_name} · ${humanise(s.simulation_run.status)} · x${s.simulation_run.speed_multiplier}`
                    : 'None'
                }
              />
              <Detail label="Data mode" value={humanise(s.data_mode)} />
              <Detail
                label="Live updates"
                value={realtime ? humanise(realtime) : 'Not connected'}
                testId="realtime-status"
              />
            </dl>
          </Card>
        )}
      </DataState>
      <DemoStoryControl />
    </div>
  );
}

// ---------------- Simulation ----------------

export function SimulationPage() {
  const queryClient = useQueryClient();
  const runs = useRuns();
  const mission = useMissionState();
  const [speed, setSpeed] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const selectedId = mission.data?.simulation_run?.simulation_run_id;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['simulation'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.missionState });
  };
  const act = useMutation({
    mutationFn: ({
      id,
      op,
    }: {
      id: string;
      op: 'start' | 'pause' | 'select' | 'speed';
    }): Promise<unknown> =>
      op === 'start'
        ? simulationApi.startRun(id)
        : op === 'pause'
          ? simulationApi.pauseRun(id)
          : op === 'select'
            ? simulationApi.selectRun(id)
            : simulationApi.updateRun(id, { speed_multiplier: speed[id] ?? 60 }),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: () => simulationApi.createRun({ run_name: name.trim(), speed_multiplier: 60 }),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulation"
        description="Start, pause, change playback speed and choose the active run."
      />
      <DataState
        status={statusOf(runs, (runs.data ?? []).length === 0)}
        error={runs.error}
        onRetry={() => void runs.refetch()}
      >
        <ul className="space-y-3">
          {(runs.data ?? []).map((r) => (
            <li key={r.simulation_run_id}>
              <Card
                className="flex flex-wrap items-center gap-3 p-4"
                data-testid="run-row"
                aria-label={r.run_name}
              >
                <div className="min-w-48 flex-1">
                  <p className="font-medium text-ink">{r.run_name}</p>
                  <p className="text-caption text-ink-subtle">
                    {r.simulation_run_id} · clock {formatTimestamp(r.current_mission_time)} ·{' '}
                    {humanise(r.data_mode)}
                  </p>
                </div>
                <StatusBadge
                  status={r.status === 'running' ? 'nominal' : 'no_data'}
                  label={humanise(r.status)}
                />
                {r.simulation_run_id === selectedId ? (
                  <span className="text-label text-accent-strong">Active run</span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act.mutate({ id: r.simulation_run_id, op: 'select' })}
                  >
                    Select
                  </Button>
                )}
                {r.status === 'running' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act.mutate({ id: r.simulation_run_id, op: 'pause' })}
                  >
                    <Pause aria-hidden="true" /> Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => act.mutate({ id: r.simulation_run_id, op: 'start' })}
                  >
                    <Play aria-hidden="true" /> Start
                  </Button>
                )}
                <label className="flex items-center gap-2 text-label text-ink-muted">
                  Speed x
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={speed[r.simulation_run_id] ?? r.speed_multiplier}
                    onChange={(e) =>
                      setSpeed({ ...speed, [r.simulation_run_id]: Number(e.target.value) })
                    }
                    className={`${field} w-24`}
                    aria-label={`Playback speed for ${r.run_name}`}
                  />
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => act.mutate({ id: r.simulation_run_id, op: 'speed' })}
                >
                  Apply speed
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </DataState>
      {act.isError && (
        <p role="alert" className="text-sm text-status-action">
          {act.error.message}
        </p>
      )}
      <Card className="flex flex-wrap items-end gap-2 p-4">
        <label className="space-y-1 text-label text-ink-muted">
          New run name
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
          Create run
        </Button>
      </Card>
    </div>
  );
}

// ---------------- Events ----------------

export function EventsPage() {
  const queryClient = useQueryClient();
  const mission = useMissionState();
  const runId = mission.data?.simulation_run?.simulation_run_id;
  const events = useQuery({
    queryKey: ['simulation', 'events', runId],
    queryFn: () => simulationApi.listEvents({ simulation_run_id: runId }),
    enabled: !!runId,
  });
  const trigger = useMutation({
    mutationFn: (id: string) => simulationApi.triggerEvent(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['simulation'] }),
  });
  const all = events.data ?? [];
  const triggered = all.filter((e) => e.source_type === 'manual_trigger').reverse();
  const predefined = all
    .filter((e) => e.source_type !== 'manual_trigger')
    .sort((a, b) => (a.mission_day ?? 0) - (b.mission_day ?? 0));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Predefined mission events. Triggering one records it at the current mission time."
      />
      {triggered.length > 0 && (
        <section aria-labelledby="triggered-title" className="space-y-2">
          <h2 id="triggered-title" className="text-title">
            Triggered this session
          </h2>
          <ul className="space-y-2">
            {triggered.map((e) => (
              <li key={e.event_id}>
                <Card className="p-3 text-sm" data-testid="triggered-event">
                  <span className="font-medium text-ink">{e.event_title}</span> · day{' '}
                  {e.mission_day} · {formatTimestamp(e.event_timestamp)}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      <DataState
        status={statusOf(events, predefined.length === 0)}
        error={events.error}
        emptyMessage="No predefined events for this run."
      >
        <ul className="space-y-2">
          {predefined.map((e) => (
            <li key={e.event_id}>
              <Card
                className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm"
                data-testid="event-row"
              >
                <span className="w-16 text-ink-subtle">Day {e.mission_day}</span>
                <span className="font-medium text-ink">{e.event_title}</span>
                <span className="text-ink-muted">
                  {humanise(e.event_type)} · {humanise(e.severity)}
                </span>
                <span className="w-full text-caption text-ink-subtle">{e.description}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => trigger.mutate(e.event_id)}
                  disabled={trigger.isPending}
                  aria-label={`Trigger ${e.event_title} (${e.event_id})`}
                >
                  <Zap aria-hidden="true" /> Trigger
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </DataState>
    </div>
  );
}

// ---------------- Data Integrity ----------------

export function DataIntegrityPage() {
  const integrity = useQuery({
    queryKey: ['missions', 'integrity'],
    queryFn: () => missionsApi.dataIntegrity(),
  });
  const outbox = useOutboxStatus();
  const d = integrity.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Integrity"
        description="Where every table comes from, and what is waiting to sync."
      />
      <Card className="space-y-2 p-4" role="region" aria-label="Sync queue">
        <h2 className="text-title">Sync queue</h2>
        <p className="text-sm" data-testid="local-queue">
          This device: {outbox.pending} item(s) waiting · {outbox.failed.length} failed
        </p>
        <p className="text-sm">
          Server sync events: {d ? d.sync_events.length : '—'} · conflicts:{' '}
          {d ? d.sync_conflicts.length : '—'}
        </p>
        {d && d.sync_events.length === 0 && (
          <p className="text-caption text-ink-subtle">No sync events have been recorded yet.</p>
        )}
      </Card>
      <DataState
        status={statusOf(integrity, !d)}
        error={integrity.error}
        onRetry={() => void integrity.refetch()}
      >
        {d && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Data lineage per table</caption>
              <thead className="bg-navy-800 text-label text-ink-muted">
                <tr>
                  {['Table', 'Rows', 'Classification', 'Sources', 'Provenance'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.lineage.map((l) => (
                  <tr key={l.csv_filename} className="border-t" data-testid="lineage-row">
                    <td className="px-3 py-2 font-mono text-caption">{l.csv_filename}</td>
                    <td className="px-3 py-2">{l.row_count}</td>
                    <td className="px-3 py-2">{humanise(l.data_classification)}</td>
                    <td className="px-3 py-2 text-caption">{l.source_ids}</td>
                    <td className="px-3 py-2 text-caption text-ink-muted">{l.provenance_note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataState>
    </div>
  );
}

// ---------------- AI Status ----------------

export function AiStatusPage() {
  const ai = useQuery({ queryKey: ['missions', 'ai'], queryFn: () => missionsApi.aiStatus() });
  const a = ai.data;
  const show = (v: boolean | number | null, yes: string, no: string) =>
    v === null ? 'No data' : typeof v === 'number' ? `${v} ms` : v ? yes : no;
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Status"
        description="The language model behind schedule explanations and research reports."
      />
      <DataState status={statusOf(ai, !a)} error={ai.error} onRetry={() => void ai.refetch()}>
        {a && (
          <Card className="space-y-3 p-5">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail
                label="Model loaded"
                value={show(a.model_loaded, 'Yes', 'No')}
                testId="ai-loaded"
              />
              <Detail
                label="Last response time"
                value={show(a.last_response_ms, '', '')}
                testId="ai-latency"
              />
              <Detail
                label="Fallback"
                value={show(a.fallback_active, 'Active (rule-based)', 'Not active')}
                testId="ai-fallback"
              />
            </dl>
            {a.recent_inferences.length === 0 && (
              <p className="text-sm text-ink-muted">
                No inference has been logged yet, so there is nothing to report.
              </p>
            )}
          </Card>
        )}
      </DataState>
    </div>
  );
}

// ---------------- Audit ----------------

export function AuditPage() {
  const log = useQuery({
    queryKey: ['missions', 'audit'],
    queryFn: () => missionsApi.auditLog({ limit: 100 }),
  });
  const rows = log.data?.items ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit"
        description="Every change made through the console, newest first."
      />
      <DataState
        status={statusOf(log, rows.length === 0)}
        error={log.error}
        onRetry={() => void log.refetch()}
        emptyMessage="No actions have been recorded yet."
      >
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Audit log</caption>
            <thead className="bg-navy-800 text-label text-ink-muted">
              <tr>
                {['Time', 'User', 'Action', 'Entity', 'Result', 'Summary'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.audit_id)} className="border-t" data-testid="audit-row">
                  <td className="px-3 py-2">{formatTimestamp(r.action_timestamp)}</td>
                  <td className="px-3 py-2">{r.user_id ?? '—'}</td>
                  <td className="px-3 py-2">{humanise(r.action_type)}</td>
                  <td className="px-3 py-2 text-caption">
                    {r.entity_type} {r.entity_id}
                  </td>
                  <td className="px-3 py-2">{humanise(r.action_result)}</td>
                  <td className="px-3 py-2 text-ink-muted">{r.change_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>
    </div>
  );
}
