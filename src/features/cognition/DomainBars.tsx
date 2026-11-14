import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CognitionDomainSummary } from '@/api/types';
import { axisTick, chartColors } from '@/components/charts/chartTheme';
import { ChartFrame } from '@/components/shared';
import { DOMAIN_LABEL } from '@/features/assessment/results';
import { formatNumber, formatUnit, humanise } from '@/lib/format';

/** One panel per domain, each in its own unit: preflight reference vs inflight median. */
export function DomainBars({ domains }: { domains: CognitionDomainSummary[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="domain-bars">
      {domains.map((d) => {
        const u = formatUnit(d.metric_unit);
        const data = [
          { label: 'Preflight reference', value: d.preflight_reference_median },
          { label: 'Inflight (range)', value: d.inflight_median },
        ].filter((x): x is { label: string; value: number } => x.value !== null);
        const name = DOMAIN_LABEL[d.cognitive_domain] ?? humanise(d.cognitive_domain);
        return (
          <ChartFrame
            key={d.cognitive_domain}
            title={name}
            unit={u}
            source={`${humanise(d.metric_name)} · median, from the backend`}
            sampleSize={d.n_inflight}
            uncertainty={`Variability: preflight SD ${d.preflight_sd ?? '—'}, inflight SD ${d.inflight_sd ?? '—'} ${u}`}
          >
            <div
              role="img"
              aria-label={`${name}: ${data.map((x) => `${x.label} ${formatNumber(x.value, 1)} ${u}`).join(', ')}`}
              style={{ height: 160 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={chartColors.grid} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} stroke={chartColors.grid} />
                  <YAxis tick={axisTick} stroke={chartColors.grid} width={48} />
                  <Tooltip
                    cursor={{ fill: 'rgba(164, 179, 204, 0.08)' }}
                    formatter={(v: number) => [`${formatNumber(v, 1)} ${u}`, name]}
                    contentStyle={{
                      background: '#13213b',
                      border: '1px solid #22355a',
                      color: '#e6edf7',
                    }}
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
          </ChartFrame>
        );
      })}
    </div>
  );
}
