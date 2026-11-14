import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { isApiError } from '@/api/client';
import { researchApi } from '@/api/research';
import type { AnalysisQuestionType } from '@/api/types';
import { QUESTION_TYPES } from './labels';
import { DataState, PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DOMAIN_LABEL } from '@/features/assessment/results';
import { formatDate, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { useAnalyses, useResearchOverview, useVariables } from './hooks';

const RADIATION = new Set(['dose_rate', 'accumulated_dose', 'estimated_dose']);
const field = 'h-10 w-full rounded-md border bg-surface-sunken px-3 text-sm text-ink';

export function AnalysesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const variables = useVariables();
  const overview = useResearchOverview();
  const analyses = useAnalyses();
  const [f, setF] = useState({
    type: 'scatter' as AnalysisQuestionType,
    question: '',
    x: 'total_sleep_minutes',
    y: 'median_reaction_time_ms',
    from: '2027-03-01',
    to: '2027-05-29',
    participants: [] as string[],
    phase: 'inflight',
    domain: '',
    quality: 'valid',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const run = useMutation({
    mutationFn: () =>
      researchApi.createAnalysis({
        analysis_type: f.type,
        research_question: f.question,
        independent_variable: f.x,
        dependent_variable: f.y,
        analysis_method: 'descriptive',
        date_range_start: f.from,
        date_range_end: f.to,
        astronaut_id: f.participants.length ? f.participants : undefined,
        mission_phase: f.phase || undefined,
        cognitive_domain: f.domain || undefined,
        quality_status: f.quality || undefined,
      }),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: ['research'] });
      void navigate(`/research/analyses/${job.analysis_id}`);
    },
  });

  const vars = variables.data ?? [];
  const option = (v: (typeof vars)[number]) => (
    <option key={v.variable} value={v.variable}>
      {humanise(v.variable)} ({v.provenance === 'estimated' ? 'Estimated' : 'Measured'}
      {v.unit ? `, ${v.unit}` : ''})
    </option>
  );
  const variableSelect = (id: string, value: string, onChange: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={field}>
      <optgroup label="Measures">
        {vars.filter((v) => !RADIATION.has(v.variable)).map(option)}
      </optgroup>
      <optgroup label="Radiation metric (kept separate)">
        {vars.filter((v) => RADIATION.has(v.variable)).map(option)}
      </optgroup>
    </select>
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run.mutate();
  };
  const fieldErrors = isApiError(run.error) ? run.error.fieldErrors : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analyses"
        description="Build an exploratory analysis. The backend computes every statistic."
      />

      <Card className="p-5">
        <DataState status={statusOf(variables, vars.length === 0)} error={variables.error}>
          <form onSubmit={submit} className="space-y-4" aria-label="Analysis builder">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="q-type" className="text-label text-ink-muted">
                  Question type
                </label>
                <select
                  id="q-type"
                  value={f.type}
                  onChange={(e) => set('type', e.target.value as AnalysisQuestionType)}
                  className={field}
                >
                  {QUESTION_TYPES.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="q-text" className="text-label text-ink-muted">
                  Research question
                </label>
                <input
                  id="q-text"
                  value={f.question}
                  onChange={(e) => set('question', e.target.value)}
                  className={field}
                  placeholder="Exploratory simulated data analysis"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="q-x" className="text-label text-ink-muted">
                  Independent variable
                </label>
                {variableSelect('q-x', f.x, (v) => set('x', v))}
              </div>
              <div className="space-y-1">
                <label htmlFor="q-y" className="text-label text-ink-muted">
                  Dependent variable
                </label>
                {variableSelect('q-y', f.y, (v) => set('y', v))}
              </div>
              <div className="space-y-1">
                <label htmlFor="q-from" className="text-label text-ink-muted">
                  From
                </label>
                <input
                  id="q-from"
                  type="date"
                  value={f.from}
                  onChange={(e) => set('from', e.target.value)}
                  className={field}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="q-to" className="text-label text-ink-muted">
                  To
                </label>
                <input
                  id="q-to"
                  type="date"
                  value={f.to}
                  onChange={(e) => set('to', e.target.value)}
                  className={field}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="q-phase" className="text-label text-ink-muted">
                  Mission phase
                </label>
                <select
                  id="q-phase"
                  value={f.phase}
                  onChange={(e) => set('phase', e.target.value)}
                  className={field}
                >
                  <option value="">Any</option>
                  <option value="preflight">Preflight</option>
                  <option value="inflight">Inflight</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="q-domain" className="text-label text-ink-muted">
                  Cognitive domain
                </label>
                <select
                  id="q-domain"
                  value={f.domain}
                  onChange={(e) => set('domain', e.target.value)}
                  className={field}
                >
                  <option value="">Any</option>
                  {['vigilance', 'attention', 'working_memory'].map((d) => (
                    <option key={d} value={d}>
                      {DOMAIN_LABEL[d]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="q-quality" className="text-label text-ink-muted">
                  Measurement quality
                </label>
                <select
                  id="q-quality"
                  value={f.quality}
                  onChange={(e) => set('quality', e.target.value)}
                  className={field}
                >
                  <option value="">Any</option>
                  <option value="valid">Valid only</option>
                </select>
              </div>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-label text-ink-muted">
                Participants (pseudonymised; none selected = all)
              </legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {(overview.data?.participant_ids ?? []).map((pid) => (
                  <label key={pid} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={f.participants.includes(pid)}
                      onChange={(e) =>
                        set(
                          'participants',
                          e.target.checked
                            ? [...f.participants, pid]
                            : f.participants.filter((p) => p !== pid),
                        )
                      }
                    />
                    {pid}
                  </label>
                ))}
              </div>
            </fieldset>
            {run.isError && (
              <div role="alert" className="text-sm text-status-action">
                {fieldErrors.length
                  ? fieldErrors.map((e) => <p key={e.field}>{e.message}</p>)
                  : run.error.message}
              </div>
            )}
            <Button type="submit" disabled={run.isPending}>
              {run.isPending ? 'Submitting…' : 'Run analysis'}
            </Button>
          </form>
        </DataState>
      </Card>

      <section aria-labelledby="analyses-title" className="space-y-3">
        <h2 id="analyses-title" className="text-title">
          Analyses
        </h2>
        <DataState
          status={statusOf(analyses, (analyses.data ?? []).length === 0)}
          error={analyses.error}
          emptyMessage="No analysis has been run yet"
        >
          <ul className="space-y-2">
            {[...(analyses.data ?? [])].reverse().map((a) => (
              <li key={a.analysis_id}>
                <Card
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4"
                  data-testid="analysis-item"
                >
                  <Link
                    to={`/research/analyses/${a.analysis_id}`}
                    className="font-medium text-accent-strong underline-offset-4 hover:underline"
                  >
                    {a.research_question}
                  </Link>
                  <span className="text-caption text-ink-subtle">
                    {a.analysis_id} · {humanise(a.analysis_type)} · {humanise(a.dependent_variable)}{' '}
                    by {humanise(a.independent_variable)} · {formatDate(a.date_range_start)}–
                    {formatDate(a.date_range_end)}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        </DataState>
      </section>
    </div>
  );
}
