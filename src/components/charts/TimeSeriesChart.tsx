import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatAxisTime, formatNumber, formatTimestamp, formatUnit } from '@/lib/format';
import { ChartTooltip } from './ChartTooltip';
import { axisTick, chartColors } from './chartTheme';
import { DataTable } from './DataTable';

export interface TimePoint {
  /** epoch ms */
  t: number;
  value: number;
  iso: string;
}

export interface ReferenceBand {
  lower: number;
  upper: number;
}

export interface TimeSeriesChartProps {
  label: string;
  unit: string | null;
  data: TimePoint[];
  /** Backend-provided personal reference, drawn as a neutral band. */
  reference?: ReferenceBand | null;
  fractionDigits?: number;
  height?: number;
}

/** One measure over time: a 2px line, a recessive grid, a hover tooltip and a table view. */
export function TimeSeriesChart({
  label,
  unit,
  data,
  reference,
  fractionDigits = 1,
  height = 220,
}: TimeSeriesChartProps) {
  const span = data.length > 1 ? data[data.length - 1]!.t - data[0]!.t : 0;
  const withTime = span <= 3 * 86_400_000;
  const u = formatUnit(unit);
  const fmt = (v: number) => `${formatNumber(v, fractionDigits)}${u ? ` ${u}` : ''}`;

  return (
    <div>
      <div
        role="img"
        aria-label={`${label} over time, ${data.length} readings${
          reference ? `, personal reference ${fmt(reference.lower)} to ${fmt(reference.upper)}` : ''
        }`}
        style={{ height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) => formatAxisTime(v, withTime)}
              tick={axisTick}
              stroke={chartColors.grid}
              minTickGap={40}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={axisTick}
              stroke={chartColors.grid}
              width={52}
              tickFormatter={(v: number) => formatNumber(v, fractionDigits)}
            />
            {reference && (
              <ReferenceArea
                y1={reference.lower}
                y2={reference.upper}
                fill={chartColors.referenceFill}
                stroke={chartColors.referenceStroke}
                strokeOpacity={0.6}
                ifOverflow="extendDomain"
              />
            )}
            <Tooltip
              cursor={{ stroke: chartColors.axis, strokeWidth: 1 }}
              content={
                <ChartTooltip
                  formatLabel={(l) => formatTimestamp(new Date(Number(l)).toISOString())}
                  formatValue={fmt}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={chartColors.series}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, stroke: chartColors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={`${label} readings`}
        rows={data}
        columns={[
          { header: 'Time', cell: (p) => formatTimestamp(p.iso) },
          {
            header: `Value${u ? ` (${u})` : ''}`,
            cell: (p) => formatNumber(p.value, fractionDigits),
          },
        ]}
      />
    </div>
  );
}
