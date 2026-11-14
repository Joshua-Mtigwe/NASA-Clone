import { extent, scaleLinear } from 'd3';
import type { CognitionDomainSummary } from '@/api/types';
import { chartColors } from '@/components/charts/chartTheme';
import { formatNumber, formatUnit } from '@/lib/format';

const WIDTH = 640;
const ROW = 56;
const LEFT = 110;

/** Deterministic jitter so dots don't overlap exactly (layout only). */
const jitter = (i: number) => (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 30;

/** Strip plot of every preflight and inflight value (D3 scale, React rendering). */
export function DistributionPlot({ domain }: { domain: CognitionDomainSummary }) {
  const all = [...domain.preflight_values, ...domain.inflight_values];
  if (all.length === 0) return null;
  const [lo, hi] = extent(all) as [number, number];
  const x = scaleLinear()
    .domain([lo, hi])
    .nice()
    .range([LEFT, WIDTH - 16]);
  const u = formatUnit(domain.metric_unit);
  const rows = [
    {
      key: 'preflight',
      label: 'Preflight',
      values: domain.preflight_values,
      color: chartColors.seriesAlt,
      sd: domain.preflight_sd,
    },
    {
      key: 'inflight',
      label: 'Inflight',
      values: domain.inflight_values,
      color: chartColors.series,
      sd: domain.inflight_sd,
    },
  ];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${rows.length * ROW + 28}`}
        className="w-full min-w-[32rem]"
        role="img"
        aria-label={`Distribution of ${domain.metric_name}: preflight n ${domain.n_preflight}, inflight n ${domain.n_inflight}`}
        data-testid="distribution-plot"
      >
        {rows.map((r, ri) => (
          <g
            key={r.key}
            transform={`translate(0, ${ri * ROW})`}
            data-testid={`distribution-${r.key}`}
          >
            <text x={0} y={ROW / 2 - 4} fontSize={12} fill="#e6edf7">
              {r.label}
            </text>
            <text x={0} y={ROW / 2 + 12} fontSize={10} fill="#a4b3cc">
              n = {r.values.length} · SD {r.sd ?? '—'}
            </text>
            <line x1={LEFT} x2={WIDTH - 16} y1={ROW / 2} y2={ROW / 2} stroke={chartColors.grid} />
            {r.values.map((v, i) => (
              <circle
                key={i}
                cx={x(v)}
                cy={ROW / 2 + jitter(i + ri * 7) * 0.5}
                r={4}
                fill={r.color}
                stroke={chartColors.surface}
                strokeWidth={2}
              >
                <title>{`${r.label}: ${formatNumber(v, 1)} ${u}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {x.ticks(6).map((t) => (
          <g key={t} transform={`translate(${x(t)}, ${rows.length * ROW + 4})`}>
            <line y1={-4} y2={0} stroke="#a4b3cc" />
            <text y={16} textAnchor="middle" fontSize={10} fill="#a4b3cc">
              {formatNumber(t, 1)}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 flex gap-4 text-caption text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: chartColors.seriesAlt }}
            aria-hidden="true"
          />
          Preflight sessions
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: chartColors.series }}
            aria-hidden="true"
          />
          Inflight daily results
        </span>
        <span>Unit: {u}</span>
      </p>
    </div>
  );
}
