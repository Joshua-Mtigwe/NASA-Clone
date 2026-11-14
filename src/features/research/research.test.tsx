import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { researchApi } from '@/api/research';
import type { AnalysisQuestionType } from '@/api/types';
import { mockState } from '@/mocks/db';
import { server } from '@/mocks/server';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});
afterEach(() => server.events.removeAllListeners());

async function runAnalysis(type: AnalysisQuestionType, extra: Record<string, unknown> = {}) {
  const job = await researchApi.createAnalysis({
    analysis_type: type,
    research_question: `Q ${type}`,
    independent_variable: 'total_sleep_minutes',
    dependent_variable: 'median_reaction_time_ms',
    analysis_method: 'descriptive',
    date_range_start: '2027-03-01',
    date_range_end: '2027-05-29',
    ...extra,
  });
  await researchApi.getAnalysis(job.analysis_id!);
  await researchApi.getAnalysis(job.analysis_id!);
  return job.analysis_id!;
}

describe('Research Overview', () => {
  it('shows participants, sessions, mission days and data quality', async () => {
    await signInAs('medical_researcher');
    const o = await researchApi.overview();
    renderApp('/research');
    expect(await screen.findByTestId('kpi-participants')).toHaveTextContent(String(o.participants));
    expect(screen.getByTestId('kpi-sessions')).toHaveTextContent(String(o.assessment_sessions));
    expect(screen.getByTestId('kpi-days')).toHaveTextContent(String(o.mission_days));
    expect(screen.getByTestId('quality')).toHaveTextContent(/Valid: \d+ sessions/);
    expect(screen.getByText(/Participants: P01, P02, P03, P04, P05/)).toBeInTheDocument();
  });
});

describe('Analysis builder', () => {
  it('offers backend variables with provenance, radiation metrics kept separate, and pseudonymised participants', async () => {
    await signInAs('medical_researcher');
    renderApp('/research/analyses');
    const form = await screen.findByRole('form', { name: 'Analysis builder' });
    const x = within(form).getByLabelText('Independent variable');
    const radiation = x.querySelector('optgroup[label="Radiation metric (kept separate)"]')!;
    expect([...radiation.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'dose_rate',
      'accumulated_dose',
      'estimated_dose',
    ]);
    expect(
      within(form).getAllByRole('option', { name: /Estimated dose \(Estimated/ }).length,
    ).toBeGreaterThan(0);
    expect(within(form).getByLabelText('P01')).toBeInTheDocument();
    expect(form.textContent).not.toMatch(/AST-00/);
    expect(within(form).getByLabelText('Question type').querySelectorAll('option')).toHaveLength(6);
  });

  it('runs an analysis, polls until it completes and shows the chart', async () => {
    const bodies: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/research/analyses'))
        bodies.push(await request.clone().json());
    });
    await signInAs('medical_researcher');
    const { router } = renderApp('/research/analyses');
    const form = await screen.findByRole('form', { name: 'Analysis builder' });
    await userEvent.type(within(form).getByLabelText('Research question'), 'Sleep and vigilance');
    await userEvent.click(within(form).getByLabelText('P02'));
    await userEvent.click(within(form).getByRole('button', { name: 'Run analysis' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/research\/analyses\/MOCK-ANL-/),
    );
    expect(bodies[0]).toMatchObject({
      analysis_type: 'scatter',
      astronaut_id: ['P02'],
      research_question: 'Sleep and vigilance',
      quality_status: 'valid',
    });
    expect(await screen.findByTestId('chart-scatter', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('shows the empty state for an analysis that has not been run', async () => {
    await signInAs('medical_researcher');
    renderApp('/research/analyses/ANL-001');
    expect(await screen.findByText('No analysis has been run yet')).toBeInTheDocument();
  });
});

describe('Analysis results', () => {
  it('shows sample size, the confidence interval and the missing-data summary on every chart', async () => {
    await signInAs('medical_researcher');
    const id = await runAnalysis('scatter');
    const [chart] = await researchApi.analysisCharts(id);
    renderApp(`/research/analyses/${id}`);
    const frame = await screen.findByRole('figure', {
      name: /median_reaction_time_ms by total_sleep_minutes/,
    });
    expect(frame).toHaveTextContent(`n = ${chart!.sample_size}`);
    expect(frame).toHaveTextContent(
      `Association r = ${chart!.effect_estimate} (95% CI ${chart!.confidence_interval_lower} to ${chart!.confidence_interval_upper})`,
    );
    expect(frame).toHaveTextContent(
      `Missing: ${chart!.missing.n_missing} of ${chart!.missing.n_total} observations`,
    );
  });

  it('defaults to the within-person view and can switch to pooled', async () => {
    const views: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/charts')) views.push(url.searchParams.get('view')!);
    });
    await signInAs('medical_researcher');
    const id = await runAnalysis('scatter');
    renderApp(`/research/analyses/${id}`);
    const frame = await screen.findByRole('figure', { name: /by total_sleep_minutes/ });
    expect(frame).toHaveTextContent('within-person view');
    expect(screen.getByRole('radio', { name: 'Within-person' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Pooled' }));
    await waitFor(() =>
      expect(screen.getByRole('figure', { name: /by total_sleep_minutes/ })).toHaveTextContent(
        'pooled view',
      ),
    );
    expect(views).toEqual(['within_person', 'pooled']);
  });

  it('draws longitudinal trends as lines and paired comparisons as bars', async () => {
    await signInAs('medical_researcher');
    const line = await runAnalysis('individual_trajectories');
    const paired = await runAnalysis('paired_preflight_inflight');
    const first = renderApp(`/research/analyses/${line}`);
    expect(await screen.findByTestId('chart-line')).toBeInTheDocument();
    first.unmount();
    renderApp(`/research/analyses/${paired}`);
    expect(await screen.findByTestId('chart-bar')).toBeInTheDocument();
    expect(
      screen.getByRole('figure', { name: /preflight vs inflight median per participant/ }),
    ).toHaveTextContent('Descriptive only, no effect estimate');
  });

  it('renders a domain heatmap per participant and domain', async () => {
    await signInAs('medical_researcher');
    const id = await runAnalysis('domain_heatmap');
    renderApp(`/research/analyses/${id}`);
    const heatmap = await screen.findByTestId('analysis-heatmap');
    expect(within(heatmap).getAllByRole('row')).toHaveLength(6);
    expect(within(heatmap).getAllByTestId('heatmap-value').length).toBe(5 * 4);
  });

  it('shows the AI-drafted report with the standing exploratory line and no causal wording', async () => {
    await signInAs('medical_researcher');
    const id = await runAnalysis('scatter');
    renderApp(`/research/analyses/${id}`);
    const report = await screen.findByRole('region', { name: 'Report' });
    expect(within(report).getByText('AI-drafted from computed results')).toBeInTheDocument();
    await waitFor(() =>
      expect(report).toHaveTextContent('This exploratory analysis of synthetic demonstration data'),
    );
    expect(within(report).getByTestId('exploratory-line')).toHaveTextContent(
      'Associations are exploratory',
    );
    expect(report.textContent).not.toMatch(
      /\b(causes|caused by|leads to|results in|because of)\b/i,
    );
  });

  it('lists drafted reports', async () => {
    await signInAs('medical_researcher');
    await runAnalysis('scatter');
    renderApp('/research/reports');
    const items = await screen.findAllByTestId('report-item');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('AI-drafted from computed results');
  });
});

describe('Planning Effectiveness', () => {
  it('keeps operational results and health hypotheses in separate sections for researchers', async () => {
    await signInAs('medical_researcher');
    renderApp('/research/effectiveness');
    const ops = await screen.findByTestId('operational-section');
    const health = screen.getByTestId('health-section');
    expect(within(ops).getByRole('heading', { name: 'Operational results' })).toBeInTheDocument();
    expect(
      within(health).getByRole('heading', { name: 'Health hypotheses (exploratory)' }),
    ).toBeInTheDocument();
    expect(within(health).getAllByTestId('domain-trend')).toHaveLength(3);
    expect(within(ops).getByText('No analysis has been run yet')).toBeInTheDocument();
    expect(ops.contains(health)).toBe(false);
  });

  it('gives mission leaders the operational section only', async () => {
    await signInAs('mission_leader');
    const data = await researchApi.planningComparison();
    expect(data.health_hypotheses).toBeNull();
    renderApp('/planner/effectiveness');
    expect(await screen.findByTestId('operational-section')).toBeInTheDocument();
    expect(screen.queryByTestId('health-section')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Health hypotheses/);
  });

  it('shows a workload heatmap cell per astronaut-day, category bars and the adherence timeline', async () => {
    await signInAs('medical_researcher');
    renderApp('/research/effectiveness');
    const heatmap = await screen.findByTestId('workload-heatmap');
    expect(within(heatmap).getAllByTestId('workload-cell')).toHaveLength(5 * 25);
    expect(screen.getByTestId('category-bars')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: /Scheduled vs completed tasks/ })).toHaveTextContent(
      'No completion records yet',
    );
  });
});

describe('mock research service', () => {
  it('centres values per participant in the within-person view and maps pseudonyms back', async () => {
    await signInAs('medical_researcher');
    const id = await runAnalysis('scatter', { astronaut_id: ['P01'] });
    const [within_] = await researchApi.analysisCharts(id, 'within_person');
    const [pooled] = await researchApi.analysisCharts(id, 'pooled');
    expect(new Set(within_!.points.map((p) => p.astronaut_id))).toEqual(new Set(['P01']));
    const meanY = within_!.points.reduce((s, p) => s + p.y, 0) / within_!.points.length;
    expect(Math.abs(meanY)).toBeLessThan(0.01);
    expect(pooled!.points[0]!.y).toBeGreaterThan(100);
    expect(within_!.sample_size).toBe(pooled!.sample_size);
  });
});
