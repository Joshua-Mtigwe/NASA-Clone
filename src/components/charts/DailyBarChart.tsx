import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatNumber, formatUnit } from '@/lib/format';
import { ChartTooltip } from './ChartTooltip';
import { axisTick, chartColors } from './chartTheme';
import { DataTable } from './DataTable';

export interface DailyPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
}

export interface DailyBarChartProps {
  label: string;
  unit: string | null;
  data: DailyPoint[];
  fractionDigits?: number;
  height?: number;
  /** Optional display transform for tooltip/table (e.g. minutes -> "6 h 50 min"). */
  formatValue?: (value: number) => string;
}

/** One value per day: thin columns (<= 24px) with rounded data ends from one baseline. */
export function DailyBarChart({
  label,
  unit,
  data,
  fractionDigits = 0,
  height = 200,
  formatValue,
}: DailyBarChartProps) {
  const u = formatUnit(unit);
  const fmt =
    formatValue ?? ((v: number) => `${formatNumber(v, fractionDigits)}${u ? ` ${u}` : ''}`);

  return (
    <div>
      <div role="img" aria-label={`${label} per day, ${data.length} days`} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            barCategoryGap={2}
          >
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d).slice(0, 6)}
              tick={axisTick}
              stroke={chartColors.grid}
              minTickGap={24}
            />
            <YAxis
              tick={axisTick}
              stroke={chartColors.grid}
              width={52}
              tickFormatter={(v: number) => formatNumber(v, fractionDigits)}
            />
            <Tooltip
              cursor={{ fill: 'rgba(164, 179, 204, 0.08)' }}
              content={
                <ChartTooltip formatLabel={(l) => formatDate(String(l))} formatValue={fmt} />
              }
            />
            <Bar
              dataKey="value"
              fill={chartColors.series}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption={`${label} per day`}
        rows={data}
        columns={[
          { header: 'Date', cell: (p) => formatDate(p.date) },
          { header: `Value${u ? ` (${u})` : ''}`, cell: (p) => fmt(p.value) },
        ]}
      />
    </div>
  );
}
