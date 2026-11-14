import { scaleQuantize } from 'd3';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PlanningComparison } from '@/api/types';
import type { PlanningEffectivenessRow } from '@/types/tables';
import { axisTick, chartColors, participantSeries } from '@/components/charts/chartTheme';
import { ChartFrame, DataState, PageHeader } from '@/components/shared';
import { DOMAIN_LABEL } from '@/features/assessment/results';
import { useSession } from '@/features/auth/sessionStore';
import { formatDate, formatMinutes, formatNumber, formatUnit, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { usePlanningComparison } from './hooks';

const RAMP = ['#0f6577', '#138aa0', '#2fb3cc', '#8fdeec'];
const CATEGORIES = ['technical', 'maintenance', 'research', 'medical'];
const tooltipStyle = { background: '#13213b', border: '1px solid #22355a', color: '#e6edf7' };

function ComparisonTable({ rows, caption }: { rows: PlanningEffectivenessRow[]; caption: string }) {
  if (rows.length === 0)
    return <DataState status="empty" emptyMessage="No analysis has been run yet" />;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-navy-800 text-label text-ink-muted">
          <tr>
            {['Period', 'Method', 'Metric', 'Estimate', 'Evaluation'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.effectiveness_id)} className="border-t">
              <td className="px-3 py-2">
                {formatDate(r.evaluation_period_start)}–{formatDate(r.evaluation_period_end)}
              </td>
              <td className="px-3 py-2">{humanise(r.planning_method)}</td>
              <td className="px-3 py-2">{humanise(r.cognitive_metric_name) || 'Operational'}</td>
              <td className="px-3 py-2">
                {r.cognitive_metric_value ?? r.task_completion_rate ?? 'No data'}
              </td>
              <td className="px-3 py-2">{humanise(r.evaluation_method)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkloadHeatmap({
  data,
}: {
  data: PlanningComparison['operational']['workload_heatmap'];
}) {
  const crew = [...new Set(data.map((d) => d.astronaut_id))];
  const dates = [...new Set(data.map((d) => d.date))];
  const max = Math.max(1, ...data.map((d) => d.scheduled_minutes));
  const color = scaleQuantize<string>().domain([0, max]).range(RAMP);
  const cell = 14;
  return (
    <div className="overflow-x-auto">
      <svg
        width={80 + dates.length * (cell + 2)}
        height={crew.length * (cell + 2) + 4}
        role="img"
        aria-label={`Scheduled task time per astronaut per day, ${dates.length} days`}
        data-testid="workload-heatmap"
      >
        {crew.map((id, r) => (
          <g key={id} transform={`translate(0, ${r * (cell + 2)})`}>
            <text x={0} y={cell - 3} fontSize={10} fill="#a4b3cc">
              {id}
            </text>
            {dates.map((date, c) => {
              const v =
                data.find((d) => d.astronaut_id === id && d.date === date)?.scheduled_minutes ?? 0;
              return (
                <rect
                  key={date}
                  x={80 + c * (cell + 2)}
                  y={0}
                  width={cell}
                  height={cell}
                  rx={2}
                  fill={v === 0 ? '#1c2e4f' : color(v)}
                  data-testid="workload-cell"
                >
                  <title>{`${id}, ${formatDate(date)}: ${formatMinutes(v)} scheduled`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      <p className="text-caption text-ink-muted">0 to {formatMinutes(max)} scheduled per day</p>
    </div>
  );
}

export function PlanningEffectivenessPage() {
  const role = useSession((s) => s.role);
  const data = usePlanningComparison();
  const d = data.data;

  const byCategory = d
    ? [...new Set(d.operational.workload_by_category.map((r) => r.astronaut_id))].map((id) => {
        const row: Record<string, string | number> = { id };
        for (const c of CATEGORIES)
          row[c] =
            d.operational.workload_by_category.find(
              (r) => r.astronaut_id === id && r.task_category === c,
            )?.scheduled_minutes ?? 0;
        return row;
      })
    : [];
  const completed =
    d?.operational.schedule_adherence.reduce((n, r) => n + r.completed_tasks, 0) ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Planning Effectiveness"
        description={`How planning played out, ${d ? `${formatDate(d.from)} to ${formatDate(d.to)}` : 'across the mission'}.`}
      />
      <DataState status={statusOf(data, !d)} error={data.error} onRetry={() => void data.refetch()}>
        {d && (
          <>
            <section
              aria-labelledby="ops-title"
              className="space-y-4 rounded-lg border border-accent/30 p-4"
              data-testid="operational-section"
            >
              <h2 id="ops-title" className="text-heading">
                Operational results
              </h2>
              <ChartFrame
                title="Workload by astronaut and day"
                unit="minutes scheduled"
                source="task_assignments (published or preloaded plan)"
                sampleSize={d.operational.workload_heatmap.length}
              >
                <WorkloadHeatmap data={d.operational.workload_heatmap} />
              </ChartFrame>
              <div className="grid gap-4 xl:grid-cols-2">
                <ChartFrame
                  title="Workload by task category"
                  unit="minutes"
                  source="task_assignments + mission_tasks"
                  sampleSize={byCategory.length}
                >
                  <div
                    style={{ height: 240 }}
                    role="img"
                    aria-label="Scheduled minutes per astronaut, grouped by task category"
                    data-testid="category-bars"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={byCategory}
                        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                        barGap={2}
                      >
                        <CartesianGrid stroke={chartColors.grid} vertical={false} />
                        <XAxis dataKey="id" tick={axisTick} stroke={chartColors.grid} />
                        <YAxis tick={axisTick} stroke={chartColors.grid} width={52} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ color: '#a4b3cc', fontSize: 12 }} />
                        {CATEGORIES.map((c, i) => (
                          <Bar
                            key={c}
                            dataKey={c}
                            name={humanise(c)}
                            fill={participantSeries[i]}
                            maxBarSize={18}
                            radius={[4, 4, 0, 0]}
                            isAnimationActive={false}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartFrame>
                <ChartFrame
                  title="Scheduled vs completed tasks"
                  unit="tasks per day"
                  source="task_assignments (planned vs actual_end)"
                  sampleSize={d.operational.schedule_adherence.length}
                  uncertainty={
                    completed === 0
                      ? 'No completion records yet: actual_end is empty in the data.'
                      : null
                  }
                >
                  <div
                    style={{ height: 240 }}
                    role="img"
                    aria-label="Scheduled and completed tasks per day"
                    data-testid="adherence-chart"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={d.operational.schedule_adherence}
                        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                      >
                        <CartesianGrid stroke={chartColors.grid} vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={axisTick}
                          stroke={chartColors.grid}
                          tickFormatter={(x: string) => x.slice(5)}
                          minTickGap={24}
                        />
                        <YAxis
                          tick={axisTick}
                          stroke={chartColors.grid}
                          width={40}
                          allowDecimals={false}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ color: '#a4b3cc', fontSize: 12 }} />
                        <Line
                          dataKey="scheduled_tasks"
                          name="Scheduled"
                          stroke={chartColors.series}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="completed_tasks"
                          name="Completed"
                          stroke={chartColors.seriesAlt}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </ChartFrame>
              </div>
              <h3 className="text-title">Planning method comparison</h3>
              <ComparisonTable rows={d.operational.comparisons} caption="Operational comparison" />
            </section>

            {d.health_hypotheses && role !== 'mission_leader' && (
              <section
                aria-labelledby="health-title"
                className="space-y-4 rounded-lg border border-status-review/40 p-4"
                data-testid="health-section"
              >
                <h2 id="health-title" className="text-heading">
                  Health hypotheses (exploratory)
                </h2>
                <p className="text-sm text-ink-muted">
                  These trends describe the crew alongside planning. They are associations to
                  investigate, not effects of the plan.
                </p>
                <div className="grid gap-4 xl:grid-cols-3">
                  {d.health_hypotheses.domain_trends.map((t) => (
                    <ChartFrame
                      key={t.cognitive_domain}
                      title={DOMAIN_LABEL[t.cognitive_domain] ?? humanise(t.cognitive_domain)}
                      unit={formatUnit(t.metric_unit)}
                      source="daily_cognitive_results (crew median per day) and cognitive_baselines"
                      sampleSize={t.points.length}
                    >
                      <div
                        style={{ height: 200 }}
                        role="img"
                        aria-label={`${t.cognitive_domain}: crew inflight median and preflight reference median`}
                        data-testid="domain-trend"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={t.points}
                            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                          >
                            <CartesianGrid stroke={chartColors.grid} vertical={false} />
                            <XAxis
                              dataKey="date"
                              tick={axisTick}
                              stroke={chartColors.grid}
                              tickFormatter={(x: string) => x.slice(5)}
                              minTickGap={24}
                            />
                            <YAxis
                              tick={axisTick}
                              stroke={chartColors.grid}
                              width={48}
                              domain={['auto', 'auto']}
                              tickFormatter={(v: number) => formatNumber(v, 0)}
                            />
                            <Tooltip contentStyle={tooltipStyle} />
                            <Legend wrapperStyle={{ color: '#a4b3cc', fontSize: 12 }} />
                            <Line
                              dataKey="crew_inflight_median"
                              name="Crew inflight median"
                              stroke={chartColors.series}
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                            <Line
                              dataKey="preflight_reference_median"
                              name="Preflight reference"
                              stroke={chartColors.seriesAlt}
                              strokeWidth={2}
                              strokeDasharray="0"
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </ChartFrame>
                  ))}
                </div>
                <h3 className="text-title">Health comparison</h3>
                <ComparisonTable
                  rows={d.health_hypotheses.comparisons}
                  caption="Health hypothesis comparison"
                />
              </section>
            )}
          </>
        )}
      </DataState>
    </div>
  );
}
