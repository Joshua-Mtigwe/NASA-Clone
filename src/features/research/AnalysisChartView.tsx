import type { ReactNode } from 'react';
import { scaleQuantize } from 'd3';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnalysisChart } from '@/api/types';
import { axisTick, chartColors, participantSeries } from '@/components/charts/chartTheme';
import { ChartFrame } from '@/components/shared';
import { DOMAIN_LABEL } from '@/features/assessment/results';
import { formatNumber, formatUnit, humanise } from '@/lib/format';
import { uncertaintyText } from './labels';

const RAMP = ['#0f6577', '#138aa0', '#2fb3cc', '#8fdeec'];
const tooltipStyle = { background: '#13213b', border: '1px solid #22355a', color: '#e6edf7' };

/** Participant colour is fixed by id (P01 -> slot 1), so filtering never repaints. */
const colourFor = (pid: string | null) => {
  const n = pid ? Number(pid.slice(1)) - 1 : 0;
  return participantSeries[n % participantSeries.length]!;
};

function Heatmap({ chart }: { chart: AnalysisChart }) {
  const domains = [...new Set(chart.points.map((p) => String(p.x)))];
  const participants = [...new Set(chart.points.map((p) => p.astronaut_id ?? ''))].sort();
  return (
    <div className="overflow-x-auto" data-testid="analysis-heatmap">
      <table className="text-caption">
        <caption className="sr-only">{chart.title}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-ink-muted">
              Participant
            </th>
            {domains.map((d) => (
              <th key={d} scope="col" className="px-2 py-1 text-ink-muted">
                {DOMAIN_LABEL[d] ?? humanise(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {participants.map((pid) => (
            <tr key={pid}>
              <th scope="row" className="px-2 py-1 text-left text-ink">
                {pid}
              </th>
              {domains.map((d) => {
                const column = chart.points.filter((p) => p.x === d).map((p) => p.y);
                const scale = scaleQuantize<string>()
                  .domain([Math.min(...column), Math.max(...column)])
                  .range(RAMP);
                const v = chart.points.find((p) => p.x === d && p.astronaut_id === pid)?.y;
                return (
                  <td key={d} className="px-1 py-1">
                    <span
                      className="flex h-9 min-w-20 items-center justify-center rounded text-label font-medium text-navy-950"
                      style={{ background: v === undefined ? '#1c2e4f' : scale(v) }}
                      data-testid="heatmap-value"
                    >
                      {v === undefined ? 'No data' : formatNumber(v, 1)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-caption text-ink-subtle">
        Shading is per domain (each column has its own unit and scale).
      </p>
    </div>
  );
}

export function AnalysisChartView({ chart }: { chart: AnalysisChart }) {
  const xu = formatUnit(chart.x.unit);
  const yu = formatUnit(chart.y.unit);
  const participants = [...new Set(chart.points.map((p) => p.astronaut_id))].sort();
  const centred =
    chart.view === 'within_person' && chart.chart_type !== 'bar' && chart.chart_type !== 'heatmap';

  let body: ReactNode;
  if (chart.chart_type === 'heatmap') {
    body = <Heatmap chart={chart} />;
  } else if (chart.chart_type === 'bar') {
    const rows = participants.map((pid) => ({
      pid,
      preflight: chart.points.find((p) => p.astronaut_id === pid && p.group === 'preflight')?.y,
      inflight: chart.points.find((p) => p.astronaut_id === pid && p.group === 'inflight')?.y,
    }));
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis dataKey="pid" tick={axisTick} stroke={chartColors.grid} />
          <YAxis tick={axisTick} stroke={chartColors.grid} width={52} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ color: '#a4b3cc', fontSize: 12 }} />
          <Bar
            dataKey="preflight"
            name="Preflight median"
            fill={chartColors.seriesAlt}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="inflight"
            name="Inflight median"
            fill={chartColors.series}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  } else if (chart.chart_type === 'line') {
    const dates = [...new Set(chart.points.map((p) => String(p.x)))].sort();
    const rows = dates.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const p of chart.points.filter((q) => q.x === date)) row[p.astronaut_id ?? 'Crew'] = p.y;
      return row;
    });
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            stroke={chartColors.grid}
            minTickGap={24}
            tickFormatter={(d: string) => d.slice(5)}
          />
          <YAxis tick={axisTick} stroke={chartColors.grid} width={52} />
          <Tooltip contentStyle={tooltipStyle} />
          {participants.length > 1 && <Legend wrapperStyle={{ color: '#a4b3cc', fontSize: 12 }} />}
          {participants.map((pid) => (
            <Line
              key={pid ?? 'crew'}
              dataKey={pid ?? 'Crew'}
              name={pid ?? 'Crew median'}
              stroke={colourFor(pid)}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  } else {
    body = (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={chartColors.grid} />
          <XAxis
            type="number"
            dataKey="x"
            name={chart.x.variable}
            tick={axisTick}
            stroke={chartColors.grid}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={chart.y.variable}
            tick={axisTick}
            stroke={chartColors.grid}
            width={52}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ color: '#a4b3cc', fontSize: 12 }} />
          {participants.map((pid) => (
            <Scatter
              key={pid ?? 'crew'}
              name={pid ?? 'Crew'}
              data={chart.points.filter((p) => p.astronaut_id === pid)}
              fill={colourFor(pid)}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ChartFrame
      title={chart.title}
      unit={
        chart.chart_type === 'scatter' ? `x ${xu || 'unitless'}, y ${yu || 'unitless'}` : yu || null
      }
      source={`Backend analysis · ${chart.view === 'within_person' ? 'within-person view' : 'pooled view'}`}
      sampleSize={chart.sample_size}
      uncertainty={uncertaintyText(chart)}
      description={
        centred ? 'Within-person view: each participant is centred on their own mean.' : undefined
      }
    >
      <div
        role="img"
        aria-label={`${chart.title}: ${chart.points.length} points, n = ${chart.sample_size}`}
        style={{ height: chart.chart_type === 'heatmap' ? 'auto' : 260 }}
        data-testid={`chart-${chart.chart_type}`}
      >
        {body}
      </div>
    </ChartFrame>
  );
}
