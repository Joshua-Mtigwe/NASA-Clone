import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisTick, chartColors } from '@/components/charts/chartTheme';
import { formatDate, formatNumber, formatUnit } from '@/lib/format';
import type { TrendPoint } from './trend';

function Dot(props: { cx?: number; cy?: number; payload?: TrendPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload?.flagged) return null;
  // Flagged days: a hollow diamond with a surface ring, explained in the legend.
  return (
    <path
      d={`M${cx},${cy - 6} L${cx + 6},${cy} L${cx},${cy + 6} L${cx - 6},${cy} Z`}
      fill={chartColors.surface}
      stroke="#e6edf7"
      strokeWidth={2}
    />
  );
}

/** Daily inflight values over the matched preflight reference interval. */
export function TrendChart({
  points,
  unit,
  label,
}: {
  points: TrendPoint[];
  unit: string;
  label: string;
}) {
  const u = formatUnit(unit);
  const flagged = points.filter((p) => p.flagged).length;
  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${points.length} daily results against the matched preflight reference; ${flagged} flagged for contextual review`}
        style={{ height: 240 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d).slice(0, 6)}
              tick={axisTick}
              stroke={chartColors.grid}
              minTickGap={24}
            />
            <YAxis tick={axisTick} stroke={chartColors.grid} width={52} domain={['auto', 'auto']} />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as TrendPoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-md border bg-popover px-3 py-2 text-caption shadow-md">
                    <p className="text-ink-muted">{formatDate(p.date)}</p>
                    <p className="text-label text-ink">
                      {formatNumber(p.value, 1)} {u}
                    </p>
                    {p.band && (
                      <p className="text-ink-muted">
                        Reference {formatNumber(p.band[0], 1)}–{formatNumber(p.band[1], 1)} {u} (
                        {p.condition})
                      </p>
                    )}
                    {p.flagged && <p className="text-ink">Flagged for contextual review</p>}
                  </div>
                );
              }}
            />
            <Area
              dataKey="band"
              type="stepAfter"
              fill={chartColors.referenceFill}
              stroke={chartColors.referenceStroke}
              strokeOpacity={0.6}
              isAnimationActive={false}
            />
            <Line
              dataKey="value"
              stroke={chartColors.series}
              strokeWidth={2}
              dot={<Dot />}
              activeDot={{ r: 4, stroke: chartColors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-4 text-caption text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-5"
            style={{ background: chartColors.series }}
            aria-hidden="true"
          />
          Inflight daily result
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-5"
            style={{ background: chartColors.referenceFill }}
            aria-hidden="true"
          />
          Matched preflight reference
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden="true">
            <path d="M6,0 L12,6 L6,12 L0,6 Z" fill="none" stroke="#e6edf7" strokeWidth="2" />
          </svg>
          Flagged for contextual review
        </span>
      </p>
    </div>
  );
}
