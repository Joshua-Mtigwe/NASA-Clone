/**
 * Mock stand-in for the backend statistics service. Exploratory and descriptive only:
 * correlations (Pearson r with a Fisher-z 95% interval), medians and counts over
 * astronaut-days. Research views use pseudonymised participant ids.
 */
import type {
  AnalysisChart,
  AnalysisChartPoint,
  AnalysisView,
  CreateAnalysisRequest,
  PlanningComparison,
  ResearchVariable,
} from '@/api/types';
import type { ResearchAnalysesRow } from '@/types/tables';
import { mockState, nextId, table } from '../db';
import { currentMissionState, minutesBetween } from './mission';
import { visibleAssignments } from './planningOps';
import { median } from './scoring';

type Series = Map<string, number>; // `${astronaut_id}|${YYYY-MM-DD}` -> value

export const RESEARCH_VARIABLES: ResearchVariable[] = [
  {
    variable: 'total_sleep_minutes',
    source_table: 'sleep_records',
    unit: 'min',
    provenance: 'measured',
    cognitive_domain: null,
  },
  {
    variable: 'sleep_efficiency_percent',
    source_table: 'sleep_records',
    unit: 'percent',
    provenance: 'measured',
    cognitive_domain: null,
  },
  {
    variable: 'dose_rate',
    source_table: 'radiation_readings',
    unit: 'uSv/h',
    provenance: 'measured',
    cognitive_domain: null,
  },
  {
    variable: 'accumulated_dose',
    source_table: 'radiation_readings',
    unit: 'mSv',
    provenance: 'measured',
    cognitive_domain: null,
  },
  {
    variable: 'estimated_dose',
    source_table: 'organ_dose_estimates',
    unit: 'mSv',
    provenance: 'estimated',
    cognitive_domain: null,
  },
  {
    variable: 'cognitive_workload',
    source_table: 'activity_records',
    unit: null,
    provenance: 'measured',
    cognitive_domain: null,
  },
  {
    variable: 'fatigue_score',
    source_table: 'assessment_context',
    unit: '1-9',
    provenance: 'measured',
    cognitive_domain: 'subjective_fatigue',
  },
  {
    variable: 'median_reaction_time_ms',
    source_table: 'daily_cognitive_results',
    unit: 'ms',
    provenance: 'measured',
    cognitive_domain: 'vigilance',
  },
  {
    variable: 'accuracy_percent',
    source_table: 'daily_cognitive_results',
    unit: 'percent',
    provenance: 'measured',
    cognitive_domain: null,
  },
];

// ---------- pseudonyms ----------

export async function pseudonyms(): Promise<{
  toPid: Map<string, string>;
  toAst: Map<string, string>;
}> {
  const ids = (await table('astronauts')).map((a) => a.astronaut_id).sort();
  const toPid = new Map(ids.map((id, i) => [id, `P${String(i + 1).padStart(2, '0')}`]));
  return { toPid, toAst: new Map([...toPid].map(([a, p]) => [p, a])) };
}

// ---------- per-analysis filters (mock memory) ----------

type Filters = Pick<
  CreateAnalysisRequest,
  'astronaut_id' | 'cognitive_domain' | 'mission_phase' | 'quality_status'
>;
const filterStore = new WeakMap<object, Map<string, Filters>>();
export function analysisFilters(): Map<string, Filters> {
  let m = filterStore.get(mockState);
  if (!m) {
    m = new Map();
    filterStore.set(mockState, m);
  }
  return m;
}

// ---------- series ----------

function add(series: Series, astronautId: string | null, ts: string | null, value: number | null) {
  if (!astronautId || !ts || value === null) return;
  series.set(`${astronautId}|${ts.slice(0, 10)}`, value);
}

async function seriesFor(variable: string, domain?: string): Promise<Series> {
  const s: Series = new Map();
  switch (variable) {
    case 'total_sleep_minutes':
    case 'sleep_efficiency_percent':
      for (const r of await table('sleep_records'))
        add(s, r.astronaut_id, r.sleep_end, r[variable]);
      break;
    case 'dose_rate':
    case 'accumulated_dose':
      for (const r of await table('radiation_readings'))
        add(s, r.astronaut_id, r.timestamp_utc, r[variable]);
      break;
    case 'estimated_dose':
      for (const r of await table('organ_dose_estimates'))
        add(s, r.astronaut_id, r.timestamp_utc, r.estimated_dose);
      break;
    case 'cognitive_workload':
      for (const r of await table('activity_records'))
        add(s, r.astronaut_id, r.start_time, r.cognitive_workload);
      break;
    case 'fatigue_score':
      for (const r of await table('assessment_context'))
        add(s, r.astronaut_id, r.timestamp_utc, r.fatigue_score);
      break;
    case 'median_reaction_time_ms':
    case 'accuracy_percent':
      for (const r of await table('daily_cognitive_results')) {
        if (r.metric_name !== variable) continue;
        if (domain && r.cognitive_domain !== domain) continue;
        add(s, r.astronaut_id, r.assessment_date, r.daily_median);
      }
      break;
  }
  return s;
}

export function pearson(
  xs: number[],
  ys: number[],
): { r: number | null; lower: number | null; upper: number | null } {
  const n = xs.length;
  if (n < 4) return { r: null, lower: null, upper: null };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return { r: null, lower: null, upper: null };
  const r = sxy / Math.sqrt(sxx * syy);
  const z = Math.atanh(Math.max(Math.min(r, 0.999999), -0.999999));
  const se = 1 / Math.sqrt(n - 3);
  return { r, lower: Math.tanh(z - 1.96 * se), upper: Math.tanh(z + 1.96 * se) };
}

const round = (n: number | null, d = 3) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
const unitOf = (v: string) => RESEARCH_VARIABLES.find((rv) => rv.variable === v)?.unit ?? null;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Centre each participant's values on their own mean (within-person view). */
function centre(points: AnalysisChartPoint[], key: 'x' | 'y') {
  const by = new Map<string, number[]>();
  for (const p of points) {
    const id = p.astronaut_id ?? '';
    by.set(id, [...(by.get(id) ?? []), Number(p[key])]);
  }
  const means = new Map([...by].map(([id, vs]) => [id, vs.reduce((a, b) => a + b, 0) / vs.length]));
  return points.map((p) => ({ ...p, [key]: Number(p[key]) - means.get(p.astronaut_id ?? '')! }));
}

export async function analysisCharts(
  analysis: ResearchAnalysesRow,
  view: AnalysisView,
): Promise<AnalysisChart[]> {
  const { toPid, toAst } = await pseudonyms();
  const { mission_time: now } = await currentMissionState();
  const filters = analysisFilters().get(analysis.analysis_id) ?? {};
  const allowed = filters.astronaut_id?.length
    ? new Set(filters.astronaut_id.map((p) => toAst.get(p) ?? p))
    : null;
  const end =
    analysis.date_range_end < now.slice(0, 10) ? analysis.date_range_end : now.slice(0, 10);
  const inScope = (astronautId: string, date: string) =>
    date >= analysis.date_range_start && date <= end && (!allowed || allowed.has(astronautId));
  const type = analysis.analysis_type;
  const base = {
    x: { variable: analysis.independent_variable, unit: unitOf(analysis.independent_variable) },
    y: { variable: analysis.dependent_variable, unit: unitOf(analysis.dependent_variable) },
    view,
  };

  if (type === 'domain_heatmap') {
    const daily = (await table('daily_cognitive_results')).filter((d) =>
      inScope(d.astronaut_id, d.assessment_date),
    );
    const domains = [...new Set(daily.map((d) => d.cognitive_domain))];
    const points: AnalysisChartPoint[] = [];
    for (const [ast, pid] of toPid) {
      for (const domain of domains) {
        const vals = daily
          .filter((d) => d.astronaut_id === ast && d.cognitive_domain === domain)
          .map((d) => d.daily_median);
        const m = median(vals);
        if (m !== null) points.push({ x: domain, y: round(m, 2)!, astronaut_id: pid });
      }
    }
    return [
      {
        ...base,
        chart_id: `${analysis.analysis_id}-heatmap`,
        chart_type: 'heatmap',
        title: 'Median daily result by participant and domain',
        points,
        sample_size: daily.length,
        effect_estimate: null,
        confidence_interval_lower: null,
        confidence_interval_upper: null,
        missing: { n_missing: 0, n_total: daily.length },
      },
    ];
  }

  const ys = await seriesFor(analysis.dependent_variable, filters.cognitive_domain);

  if (type === 'paired_preflight_inflight') {
    const sessions = await table('assessment_sessions');
    const results = await table('assessment_results');
    const preIds = new Set(
      sessions.filter((s) => s.mission_phase === 'preflight').map((s) => s.session_id),
    );
    const sessionAst = new Map(sessions.map((s) => [s.session_id, s.astronaut_id]));
    const points: AnalysisChartPoint[] = [];
    let n = 0;
    for (const [ast, pid] of toPid) {
      if (allowed && !allowed.has(ast)) continue;
      const pre = results
        .filter(
          (r) =>
            preIds.has(r.session_id) &&
            sessionAst.get(r.session_id) === ast &&
            r.metric_name === analysis.dependent_variable &&
            (!filters.cognitive_domain || r.cognitive_domain === filters.cognitive_domain),
        )
        .map((r) => r.metric_value);
      const inflight = [...ys]
        .filter(([k]) => k.startsWith(`${ast}|`) && inScope(ast, k.split('|')[1]!))
        .map(([, v]) => v);
      const mp = median(pre);
      const mi = median(inflight);
      if (mp !== null && mi !== null) {
        points.push(
          { x: pid, y: round(mp, 2)!, astronaut_id: pid, group: 'preflight' },
          { x: pid, y: round(mi, 2)!, astronaut_id: pid, group: 'inflight' },
        );
        n += pre.length + inflight.length;
      }
    }
    return [
      {
        ...base,
        chart_id: `${analysis.analysis_id}-paired`,
        chart_type: 'bar',
        title: `${analysis.dependent_variable}: preflight vs inflight median per participant`,
        points,
        sample_size: n,
        effect_estimate: null,
        confidence_interval_lower: null,
        confidence_interval_upper: null,
        missing: { n_missing: 0, n_total: n },
      },
    ];
  }

  if (type === 'longitudinal' || type === 'individual_trajectories') {
    const rows = [...ys]
      .map(([k, v]) => ({ ast: k.split('|')[0]!, date: k.split('|')[1]!, v }))
      .filter((r) => inScope(r.ast, r.date));
    let points: AnalysisChartPoint[];
    if (type === 'longitudinal' && view === 'pooled') {
      const dates = [...new Set(rows.map((r) => r.date))].sort();
      points = dates.map((date) => ({
        x: date,
        y: round(median(rows.filter((r) => r.date === date).map((r) => r.v)), 2)!,
        astronaut_id: null,
      }));
    } else {
      points = rows
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ x: r.date, y: r.v, astronaut_id: toPid.get(r.ast)! }));
      if (view === 'within_person')
        points = centre(points, 'y').map((p) => ({ ...p, y: round(p.y, 2)! }));
    }
    return [
      {
        ...base,
        chart_id: `${analysis.analysis_id}-line`,
        chart_type: 'line',
        title: `${analysis.dependent_variable} over the mission`,
        points,
        sample_size: rows.length,
        effect_estimate: null,
        confidence_interval_lower: null,
        confidence_interval_upper: null,
        missing: { n_missing: 0, n_total: rows.length },
      },
    ];
  }

  // scatter (default, also the CSV analyses) and lagged comparison
  const xs = await seriesFor(analysis.independent_variable);
  const lag = type === 'lagged_comparison' ? 1 : 0;
  const keys = new Set([...ys.keys()]);
  let points: AnalysisChartPoint[] = [];
  let missing = 0;
  let total = 0;
  for (const key of keys) {
    const [ast, date] = key.split('|') as [string, string];
    if (!inScope(ast, date)) continue;
    total += 1;
    const x = xs.get(`${ast}|${shift(date, -lag)}`);
    const y = ys.get(key);
    if (x === undefined || y === undefined) {
      missing += 1;
      continue;
    }
    points.push({ x, y, astronaut_id: toPid.get(ast)! });
  }
  if (view === 'within_person') points = centre(centre(points, 'x'), 'y');
  const stats = pearson(
    points.map((p) => Number(p.x)),
    points.map((p) => p.y),
  );
  points = points.map((p) => ({ ...p, x: round(Number(p.x), 3)!, y: round(p.y, 3)! }));
  return [
    {
      ...base,
      chart_id: `${analysis.analysis_id}-scatter`,
      chart_type: 'scatter',
      title: lag
        ? `${analysis.dependent_variable} by previous day's ${analysis.independent_variable}`
        : `${analysis.dependent_variable} by ${analysis.independent_variable}`,
      points,
      sample_size: points.length,
      effect_estimate: round(stats.r),
      confidence_interval_lower: round(stats.lower),
      confidence_interval_upper: round(stats.upper),
      missing: { n_missing: missing, n_total: total },
    },
  ];
}

/** Template stand-in for the backend's LLM report (Gemma). It only restates computed numbers. */
export async function draftReport(
  analysis: ResearchAnalysesRow,
  chart: AnalysisChart,
  now: string,
) {
  const ci =
    chart.confidence_interval_lower !== null
      ? ` (95% CI ${chart.confidence_interval_lower} to ${chart.confidence_interval_upper})`
      : '';
  const effect =
    chart.effect_estimate !== null
      ? ` The association estimate is r = ${chart.effect_estimate}${ci}.`
      : '';
  const text =
    `This exploratory analysis of synthetic demonstration data looked at ${analysis.dependent_variable} and ${analysis.independent_variable} ` +
    `between ${analysis.date_range_start} and ${analysis.date_range_end}, using ${chart.sample_size} observations in a ${chart.view.replace('_', '-')} view.` +
    `${effect} ${chart.missing.n_missing} of ${chart.missing.n_total} observations had missing values. ` +
    'Associations are exploratory and do not show that one variable affects the other.';
  (await table('research_reports')).push({
    report_id: nextId('RPT'),
    analysis_id: analysis.analysis_id,
    simulation_run_id: mockState.selectedRunId,
    title: `Summary: ${analysis.research_question}`,
    status: 'draft',
    model_id: 'mock_template_v1 (no model loaded)',
    evidence_hash: chart.chart_id,
    report_text: text,
    created_at: now,
    reviewed_by_user_id: null,
    reviewed_at: null,
    data_classification: 'synthetic_demo',
  });
}

/** Operational planning outcomes and health hypotheses, kept in separate sections. */
export async function planningComparison(includeHealth: boolean): Promise<PlanningComparison> {
  const state = await currentMissionState();
  const launch = state.mission.launch_date.slice(0, 10);
  const today = state.mission_time.slice(0, 10);
  const [astronauts, tasks, effectiveness] = await Promise.all([
    table('astronauts'),
    table('mission_tasks'),
    table('planning_effectiveness'),
  ]);
  const taskById = new Map(tasks.map((t) => [t.task_id, t]));

  const heatmap: PlanningComparison['operational']['workload_heatmap'] = [];
  const byCategory = new Map<string, number>();
  const adherence: PlanningComparison['operational']['schedule_adherence'] = [];
  for (let d = launch; d <= today; d = shift(d, 1)) {
    const assignments = await visibleAssignments(d);
    for (const a of astronauts) {
      const mine = assignments.filter((x) => x.astronaut_id === a.astronaut_id);
      heatmap.push({
        astronaut_id: a.astronaut_id,
        date: d,
        scheduled_minutes: mine.reduce(
          (s, x) => s + (minutesBetween(x.planned_start, x.planned_end) ?? 0),
          0,
        ),
      });
      for (const x of mine) {
        const key = `${a.astronaut_id}|${taskById.get(x.task_id)?.task_category ?? 'unknown'}`;
        byCategory.set(
          key,
          (byCategory.get(key) ?? 0) + (minutesBetween(x.planned_start, x.planned_end) ?? 0),
        );
      }
    }
    adherence.push({
      date: d,
      scheduled_tasks: assignments.length,
      completed_tasks: assignments.filter((x) => x.actual_end !== null).length,
    });
  }

  let health: PlanningComparison['health_hypotheses'] = null;
  if (includeHealth) {
    const daily = (await table('daily_cognitive_results')).filter(
      (r) => r.assessment_date <= today && r.cognitive_domain !== 'subjective_fatigue',
    );
    const baselines = await table('cognitive_baselines');
    const domains = [...new Set(daily.map((d) => d.cognitive_domain))];
    health = {
      domain_trends: domains.map((domain) => {
        const rows = daily.filter((r) => r.cognitive_domain === domain);
        const ref = median(
          baselines.filter((b) => b.cognitive_domain === domain).map((b) => b.median_value),
        );
        const dates = [...new Set(rows.map((r) => r.assessment_date))].sort();
        return {
          cognitive_domain: domain,
          metric_unit: rows[0]!.metric_unit,
          points: dates.map((date) => ({
            date,
            crew_inflight_median: round(
              median(rows.filter((r) => r.assessment_date === date).map((r) => r.daily_median)),
              2,
            )!,
            preflight_reference_median: round(ref, 2),
          })),
        };
      }),
      comparisons: effectiveness.filter((r) => r.cognitive_metric_name !== null),
    };
  }

  return {
    from: launch,
    to: today,
    operational: {
      workload_heatmap: heatmap,
      workload_by_category: [...byCategory].map(([k, m]) => ({
        astronaut_id: k.split('|')[0]!,
        task_category: k.split('|')[1]!,
        scheduled_minutes: m,
      })),
      schedule_adherence: adherence,
      comparisons: effectiveness.filter((r) => r.cognitive_metric_name === null),
    },
    health_hypotheses: health,
  };
}
