import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { assessmentsApi } from '@/api/assessments';
import type { AssessmentScheduleTemplatesRow } from '@/types/tables';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CONDITION_LABELS } from '@/features/assessment/battery/registry';
import { useCrew } from '@/features/planning/hooks';
import { useMissionState } from '@/features/shell/useMissionState';
import { formatDate, formatNumber, formatTimestamp, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';

const field = 'h-9 rounded-md border bg-surface-sunken px-2 text-sm text-ink';

// ---------------- Oversight ----------------

export function OversightPage() {
  const oversight = useQuery({
    queryKey: ['assessments', 'oversight'],
    queryFn: () => assessmentsApi.oversight(),
  });
  const rows = oversight.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Oversight"
        description="Assessment completion and data quality per astronaut, up to the mission clock."
      />
      <DataState
        status={statusOf(oversight, rows.length === 0)}
        error={oversight.error}
        onRetry={() => void oversight.refetch()}
      >
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Completion and data quality per astronaut</caption>
            <thead className="bg-navy-800 text-label text-ink-muted">
              <tr>
                {['Astronaut', 'Completed', 'Valid quality', 'Flagged for contextual review'].map(
                  (h) => (
                    <th key={h} scope="col" className="px-3 py-2">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.astronaut_id} className="border-t" data-testid="oversight-row">
                  <td className="px-3 py-2 text-ink">{r.astronaut_id}</td>
                  <td className="px-3 py-2">
                    {r.sessions_completed} of {r.sessions_total} sessions
                  </td>
                  <td className="px-3 py-2">
                    {r.sessions_valid} of {r.sessions_completed}
                  </td>
                  <td className="px-3 py-2">
                    {r.flagged_for_review > 0 ? (
                      <Link
                        to={`/medical/assessments?astronaut=${r.astronaut_id}`}
                        className="text-accent-strong underline-offset-4 hover:underline"
                      >
                        {r.flagged_for_review} to review
                      </Link>
                    ) : (
                      'None'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataState>
    </div>
  );
}

// ---------------- Assessment Programmes ----------------

const CONDITIONS = Object.keys(CONDITION_LABELS);

export function ProgrammesPage() {
  const queryClient = useQueryClient();
  const mission = useMissionState();
  const crew = useCrew();
  const protocols = useQuery({
    queryKey: ['assessments', 'protocols'],
    queryFn: () => assessmentsApi.protocols(),
  });
  const templates = useQuery({
    queryKey: ['assessments', 'templates'],
    queryFn: () => assessmentsApi.listTemplates(),
  });
  const today = mission.data?.mission_time.slice(0, 10) ?? '';
  const [p, setP] = useState({
    name: '',
    phase: 'inflight',
    start: '',
    end: '',
    hour: 8,
    frequency: 'daily',
    tests: {} as Record<string, string[]>,
  });
  const [created, setCreated] = useState<AssessmentScheduleTemplatesRow[]>([]);
  const [assignTo, setAssignTo] = useState<string[]>([]);
  const [assignDate, setAssignDate] = useState('');

  const conditions = Object.keys(p.tests);
  const toggleCondition = (c: string, on: boolean) =>
    setP((s) => {
      const tests = { ...s.tests };
      if (on) tests[c] = tests[c] ?? [];
      else delete tests[c];
      return { ...s, tests };
    });
  const toggleTest = (c: string, id: string, on: boolean) =>
    setP((s) => ({
      ...s,
      tests: {
        ...s.tests,
        [c]: on ? [...(s.tests[c] ?? []), id] : (s.tests[c] ?? []).filter((x) => x !== id),
      },
    }));

  const create = useMutation({
    mutationFn: async () => {
      const out: AssessmentScheduleTemplatesRow[] = [];
      for (const c of conditions) {
        out.push(
          await assessmentsApi.createTemplate({
            mission_phase: p.phase,
            assessment_condition: c,
            local_hour: p.hour,
            protocol_ids: (p.tests[c] ?? []).join('|'),
            recurrence: p.frequency,
            description: p.name.trim(),
            collection_start: p.start || undefined,
            collection_end: p.end || undefined,
          }),
        );
      }
      return out;
    },
    onSuccess: (rows) => {
      setCreated(rows);
      setAssignDate(p.start || today);
      void queryClient.invalidateQueries({ queryKey: ['assessments', 'templates'] });
    },
  });

  const assign = useMutation({
    mutationFn: async () => {
      let n = 0;
      for (const t of created) {
        const rows = await assessmentsApi.createAssignments({
          astronaut_ids: assignTo,
          template_id: t.template_id,
          scheduled_at: `${assignDate}T${String(t.local_hour).padStart(2, '0')}:00:00Z`,
        });
        n += rows.length;
      }
      return n;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assessments'] }),
  });

  const invalid =
    !p.name.trim() ||
    conditions.length === 0 ||
    conditions.some((c) => (p.tests[c] ?? []).length === 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessment Programmes"
        description="Build a protocol: collection period, conditions, tests per condition and frequency. Then assign it."
      />

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4" aria-label="Protocol builder">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-label text-ink-muted">
              Programme name
              <input
                value={p.name}
                onChange={(e) => setP({ ...p, name: e.target.value })}
                className={`${field} w-full`}
              />
            </label>
            <label className="space-y-1 text-label text-ink-muted">
              Mission phase
              <select
                value={p.phase}
                onChange={(e) => setP({ ...p, phase: e.target.value })}
                className={`${field} w-full`}
              >
                <option value="preflight">Preflight</option>
                <option value="inflight">Inflight</option>
              </select>
            </label>
            <label className="space-y-1 text-label text-ink-muted">
              Frequency
              <select
                value={p.frequency}
                onChange={(e) => setP({ ...p, frequency: e.target.value })}
                className={`${field} w-full`}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="on_demand">Once</option>
              </select>
            </label>
            <label className="space-y-1 text-label text-ink-muted">
              Collection starts
              <input
                type="date"
                value={p.start}
                onChange={(e) => setP({ ...p, start: e.target.value })}
                className={`${field} w-full`}
              />
            </label>
            <label className="space-y-1 text-label text-ink-muted">
              Collection ends
              <input
                type="date"
                value={p.end}
                onChange={(e) => setP({ ...p, end: e.target.value })}
                className={`${field} w-full`}
              />
            </label>
            <label className="space-y-1 text-label text-ink-muted">
              Local hour (UTC)
              <input
                type="number"
                min={0}
                max={23}
                value={p.hour}
                onChange={(e) => setP({ ...p, hour: Number(e.target.value) })}
                className={`${field} w-full`}
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-label text-ink-muted">
              Conditions and the tests run under each
            </legend>
            {CONDITIONS.map((c) => (
              <div key={c} className="rounded-md border p-3" data-testid={`condition-${c}`}>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={c in p.tests}
                    onChange={(e) => toggleCondition(c, e.target.checked)}
                  />
                  {CONDITION_LABELS[c]}
                </label>
                {c in p.tests && (
                  <div className="mt-2 flex flex-wrap gap-3 pl-6 text-sm">
                    {(protocols.data ?? []).map((pr) => (
                      <label key={pr.protocol_id} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          aria-label={`${CONDITION_LABELS[c]}: ${pr.protocol_name}`}
                          checked={(p.tests[c] ?? []).includes(pr.protocol_id)}
                          onChange={(e) => toggleTest(c, pr.protocol_id, e.target.checked)}
                        />
                        {pr.protocol_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
          {create.isError && (
            <p role="alert" className="text-sm text-status-action">
              {create.error.message}
            </p>
          )}
          <Button type="submit" disabled={invalid || create.isPending}>
            Create programme
          </Button>
          {invalid && (
            <p className="text-caption text-ink-subtle">
              Name the programme and choose at least one test for every selected condition.
            </p>
          )}
        </form>
      </Card>

      {created.length > 0 && (
        <Card className="space-y-3 p-5" role="region" aria-label="Assign programme">
          <h2 className="text-title">Assign to astronauts</h2>
          <p className="text-sm text-ink-muted">
            Created {created.length} schedule template(s):{' '}
            {created.map((t) => t.template_id).join(', ')}.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {(crew.data ?? []).map((a) => (
              <label key={a.astronaut_id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={assignTo.includes(a.astronaut_id)}
                  onChange={(e) =>
                    setAssignTo(
                      e.target.checked
                        ? [...assignTo, a.astronaut_id]
                        : assignTo.filter((x) => x !== a.astronaut_id),
                    )
                  }
                />
                {a.astronaut_code}
              </label>
            ))}
          </div>
          <label className="block space-y-1 text-label text-ink-muted">
            First session date
            <input
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              className={field}
            />
          </label>
          <Button
            onClick={() => assign.mutate()}
            disabled={assignTo.length === 0 || !assignDate || assign.isPending}
          >
            Assign
          </Button>
          {assign.isSuccess && (
            <p role="status" className="text-sm text-status-nominal">
              {assign.data} assignments created. They wait for an access grant.
            </p>
          )}
          {assign.isError && (
            <p role="alert" className="text-sm text-status-action">
              {assign.error.message}
            </p>
          )}
        </Card>
      )}

      <section aria-labelledby="templates-title" className="space-y-3">
        <h2 id="templates-title" className="text-title">
          Existing programmes
        </h2>
        <DataState
          status={statusOf(templates, (templates.data ?? []).length === 0)}
          error={templates.error}
        >
          <ul className="space-y-2">
            {(templates.data ?? []).map((t) => (
              <li key={t.template_id}>
                <Card
                  className="flex flex-wrap gap-x-4 gap-y-1 p-3 text-sm"
                  data-testid="template-row"
                >
                  <span className="font-medium text-ink">{t.template_id}</span>
                  <span>
                    {humanise(t.mission_phase)} ·{' '}
                    {CONDITION_LABELS[t.assessment_condition] ?? t.assessment_condition} ·{' '}
                    {humanise(t.recurrence)} at {String(t.local_hour).padStart(2, '0')}:00
                  </span>
                  <span className="text-ink-muted">{t.protocol_ids.split('|').join(', ')}</span>
                  {t.description && (
                    <span className="w-full text-caption text-ink-subtle">{t.description}</span>
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

// ---------------- Access Grants ----------------

export function AccessGrantsPage() {
  const queryClient = useQueryClient();
  const mission = useMissionState();
  const scheduled = useQuery({
    queryKey: ['assessments', 'assignments', 'scheduled'],
    queryFn: () => assessmentsApi.listAssignments({ access_status: 'scheduled', limit: 500 }),
  });
  const authorized = useQuery({
    queryKey: ['assessments', 'assignments', 'authorized'],
    queryFn: () => assessmentsApi.listAssignments({ access_status: 'authorized', limit: 500 }),
  });
  const [until, setUntil] = useState('');
  const defaultUntil = mission.data ? `${mission.data.mission_time.slice(0, 10)}T23:59` : '';
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['assessments'] });
  const grant = useMutation({
    mutationFn: (id: string) =>
      assessmentsApi.grantAccess(id, { access_expires_at: `${until || defaultUntil}:00Z` }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => assessmentsApi.revokeAccess(id),
    onSuccess: refresh,
  });

  const table = (rows: typeof scheduled.data, action: 'grant' | 'revoke') => (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">
          {action === 'grant' ? 'Waiting for access' : 'Access granted'}
        </caption>
        <thead className="bg-navy-800 text-label text-ink-muted">
          <tr>
            {[
              'Astronaut',
              'Test',
              'Condition',
              'Scheduled',
              action === 'grant' ? 'Grant' : 'Revoke',
            ].map((h) => (
              <th key={h} scope="col" className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows?.items ?? []).map((a) => (
            <tr key={a.assignment_id} className="border-t" data-testid={`${action}-row`}>
              <td className="px-3 py-2">{a.astronaut_id}</td>
              <td className="px-3 py-2">{a.protocol_id}</td>
              <td className="px-3 py-2">
                {CONDITION_LABELS[a.assessment_condition] ?? a.assessment_condition}
              </td>
              <td className="px-3 py-2">
                {formatTimestamp(a.scheduled_at)}
                {action === 'revoke' && ` · until ${formatTimestamp(a.access_expires_at)}`}
              </td>
              <td className="px-3 py-2">
                {action === 'grant' ? (
                  <Button
                    size="sm"
                    onClick={() => grant.mutate(a.assignment_id)}
                    disabled={grant.isPending}
                  >
                    Grant
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => revoke.mutate(a.assignment_id)}
                    disabled={revoke.isPending}
                  >
                    Revoke
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access Grants"
        description="Astronauts can start an assessment only after access is granted."
      />
      <label className="block space-y-1 text-label text-ink-muted">
        Grant access until (UTC)
        <input
          type="datetime-local"
          value={until || defaultUntil}
          onChange={(e) => setUntil(e.target.value)}
          className={field}
        />
      </label>
      <section className="space-y-2" aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="text-title">
          Waiting for access
        </h2>
        <DataState
          status={statusOf(scheduled, (scheduled.data?.items ?? []).length === 0)}
          error={scheduled.error}
          emptyMessage="No assignments are waiting for access."
        >
          {table(scheduled.data, 'grant')}
        </DataState>
      </section>
      <section className="space-y-2" aria-labelledby="granted-title">
        <h2 id="granted-title" className="text-title">
          Access granted
        </h2>
        <DataState
          status={statusOf(authorized, (authorized.data?.items ?? []).length === 0)}
          error={authorized.error}
          emptyMessage="No open access grants."
        >
          {table(authorized.data, 'revoke')}
        </DataState>
      </section>
    </div>
  );
}

// ---------------- Crew Assessments ----------------

export function CrewAssessmentsPage() {
  const [params] = useSearchParams();
  const [astronaut, setAstronaut] = useState(params.get('astronaut') ?? '');
  const crew = useCrew();
  const flagged = useQuery({
    queryKey: ['assessments', 'flagged', astronaut],
    queryFn: () => assessmentsApi.flagged(astronaut || undefined),
  });
  const rows = [...(flagged.data ?? [])].sort((a, b) =>
    b.calculated_at.localeCompare(a.calculated_at),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Crew Assessments"
        description="Results outside the personal preflight reference, for contextual review. A flag is not a diagnosis."
      />
      <label className="block space-y-1 text-label text-ink-muted">
        Astronaut
        <select value={astronaut} onChange={(e) => setAstronaut(e.target.value)} className={field}>
          <option value="">All crew</option>
          {(crew.data ?? []).map((a) => (
            <option key={a.astronaut_id} value={a.astronaut_id}>
              {a.astronaut_code}
            </option>
          ))}
        </select>
      </label>
      <DataState
        status={statusOf(flagged, rows.length === 0)}
        error={flagged.error}
        emptyMessage="No results are flagged for contextual review."
      >
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.comparison_id}>
              <Card
                className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm"
                data-testid="flagged-row"
              >
                <StatusBadge status="review" label="flagged for contextual review" />
                <span className="text-ink">{c.astronaut_id}</span>
                <span>{formatDate(c.calculated_at)}</span>
                <span>
                  Result {formatNumber(c.inflight_value, 1)} vs preflight{' '}
                  {formatNumber(c.baseline_value, 1)} ({formatNumber(c.percentage_difference, 1)}%
                  difference)
                </span>
                <span className="text-caption text-ink-subtle">
                  Matched by {humanise(c.comparison_method).toLowerCase()} · {c.comparison_id}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      </DataState>
    </div>
  );
}
