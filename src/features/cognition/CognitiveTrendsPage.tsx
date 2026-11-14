import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { cognitionApi } from '@/api/cognition';
import type { Role } from '@/api/types';
import { ChartFrame, DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { DOMAIN_LABEL } from '@/features/assessment/results';
import { useSession } from '@/features/auth/sessionStore';
import { COGNITIVE_DOMAINS, shiftDate } from '@/features/health/config';
import { useMissionState } from '@/features/shell/useMissionState';
import { useActiveAstronaut } from '@/features/shell/useActiveAstronaut';
import { downloadCsv, toCsv } from '@/lib/csv';
import { formatDate, formatNumber, formatUnit, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { CompletionHeatmap } from './CompletionHeatmap';
import { DistributionPlot } from './DistributionPlot';
import { DomainBars } from './DomainBars';
import { toTrendPoints } from './trend';
import { TrendChart } from './TrendChart';

type Range = '7d' | '30d' | 'mission';
const RANGES: Array<{ key: Range; label: string }> = [
  { key: '7d', label: '7 d' },
  { key: '30d', label: '30 d' },
  { key: 'mission', label: 'Mission' },
];

/** Roles allowed to export the detail table. */
const EXPORT_ROLES: readonly Role[] = ['astronaut', 'medical_researcher', 'medical_officer'];

export function ResearchCognitionPage() {
  return <CognitiveTrendsPage title="Cognition Comparison" />;
}

export function CognitiveTrendsPage({ title = 'Cognitive Trends' }: { title?: string }) {
  const role = useSession((s) => s.role);
  const astronautId = useActiveAstronaut();
  const mission = useMissionState();
  const [domain, setDomain] = useState<string>('vigilance');
  const [range, setRange] = useState<Range>('30d');

  const today = mission.data?.mission_time.slice(0, 10) ?? null;
  const launch = mission.data?.mission.launch_date.slice(0, 10) ?? null;
  const from =
    today && launch
      ? range === 'mission'
        ? launch
        : shiftDate(today, range === '7d' ? -6 : -29)
      : null;
  const bounds = from && today ? { from, to: today } : null;

  const comparisons = useQuery({
    queryKey: ['cognition', astronautId, 'comparisons', domain, bounds],
    queryFn: () =>
      cognitionApi.comparisons({
        astronaut_id: astronautId!,
        cognitive_domain: domain,
        ...bounds!,
      }),
    enabled: !!astronautId && !!bounds,
  });
  const summary = useQuery({
    queryKey: ['cognition', astronautId, 'summary', bounds],
    queryFn: () => cognitionApi.summary({ astronaut_id: astronautId!, ...bounds! }),
    enabled: !!astronautId && !!bounds,
  });

  const missionTime = mission.data?.mission_time ?? '';
  const views = (comparisons.data ?? []).filter((v) => v.comparison.calculated_at <= missionTime);
  const points = toTrendPoints(views);
  const domainSummary = summary.data?.domains.find((d) => d.cognitive_domain === domain);
  const unit = views[0]?.daily_result.metric_unit ?? domainSummary?.metric_unit ?? '';
  const label = DOMAIN_LABEL[domain] ?? humanise(domain);
  const rows = [...views].sort((a, b) =>
    b.daily_result.assessment_date.localeCompare(a.daily_result.assessment_date),
  );
  const canExport = role !== null && EXPORT_ROLES.includes(role);

  const exportCsv = () => {
    const csv = toCsv(
      [
        'date',
        'mission_day',
        'cognitive_domain',
        'metric_name',
        'value',
        'unit',
        'reference_lower',
        'reference_upper',
        'assessment_condition',
        'comparison_method',
        'valid_trials',
        'sessions_completed',
        'reference_range_status',
      ],
      rows.map((v) => [
        v.daily_result.assessment_date,
        v.daily_result.mission_day,
        v.daily_result.cognitive_domain,
        v.daily_result.metric_name,
        v.comparison.inflight_value,
        v.daily_result.metric_unit,
        v.baseline?.reference_lower ?? null,
        v.baseline?.reference_upper ?? null,
        v.baseline?.assessment_condition ?? null,
        v.comparison.comparison_method,
        v.daily_result.valid_trials,
        v.daily_result.sessions_completed,
        v.comparison.reference_range_status,
      ]),
    );
    downloadCsv(`cognitive-trends-${astronautId}-${domain}-${bounds?.from}-${bounds?.to}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={`Daily results for ${astronautId ?? '—'} against the matched personal preflight reference. Each domain keeps its own unit.`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Cognitive domain" className="flex flex-wrap gap-1">
          {COGNITIVE_DOMAINS.map((d) => (
            <Button
              key={d.key}
              size="sm"
              variant={d.key === domain ? 'default' : 'outline'}
              aria-pressed={d.key === domain}
              onClick={() => setDomain(d.key)}
            >
              {d.label}
            </Button>
          ))}
        </div>
        <div role="group" aria-label="Time range" className="flex gap-1 rounded-md border p-1">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              size="sm"
              variant={r.key === range ? 'default' : 'ghost'}
              aria-pressed={r.key === range}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <ChartFrame
        title={`${label} over time`}
        unit={formatUnit(unit) || null}
        source="cognitive_comparisons + cognitive_baselines (backend)"
        sampleSize={comparisons.data ? points.length : null}
        uncertainty={
          domainSummary
            ? `${domainSummary.outside_reference} of ${domainSummary.within_reference + domainSummary.outside_reference} days flagged for contextual review · reference matched by time of day and session condition`
            : 'Reference matched by time of day and session condition'
        }
      >
        <DataState
          status={statusOf(comparisons, points.length === 0, 'no-data')}
          error={comparisons.error}
          onRetry={() => void comparisons.refetch()}
          noDataMessage={`No data: no ${label.toLowerCase()} results in this range.`}
        >
          <TrendChart points={points} unit={unit} label={label} />
        </DataState>
      </ChartFrame>

      <section aria-labelledby="domains-title" className="space-y-3">
        <h2 id="domains-title" className="text-title">
          Domains compared
        </h2>
        <DataState
          status={statusOf(summary, (summary.data?.domains.length ?? 0) === 0, 'no-data')}
          error={summary.error}
        >
          {summary.data && <DomainBars domains={summary.data.domains} />}
        </DataState>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame
          title="Assessment completion"
          unit="sessions per day"
          source="assessment_sessions (backend count)"
          sampleSize={summary.data?.completion_by_day.length ?? null}
        >
          <DataState
            status={statusOf(
              summary,
              (summary.data?.completion_by_day.length ?? 0) === 0,
              'no-data',
            )}
            error={summary.error}
          >
            {summary.data && <CompletionHeatmap days={summary.data.completion_by_day} />}
          </DataState>
        </ChartFrame>
        <ChartFrame
          title={`${label}: preflight vs inflight variability`}
          unit={formatUnit(unit) || null}
          source="assessment_results (preflight) and daily_cognitive_results (inflight)"
          sampleSize={domainSummary ? domainSummary.n_preflight + domainSummary.n_inflight : null}
          uncertainty={
            domainSummary
              ? `SD preflight ${domainSummary.preflight_sd ?? '—'}, inflight ${domainSummary.inflight_sd ?? '—'}`
              : null
          }
        >
          <DataState
            status={statusOf(summary, !domainSummary, 'no-data')}
            error={summary.error}
            noDataMessage="No data for this domain."
          >
            {domainSummary && <DistributionPlot domain={domainSummary} />}
          </DataState>
        </ChartFrame>
      </div>

      <section aria-labelledby="detail-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="detail-title" className="text-title">
            Daily detail
          </h2>
          {canExport && rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download aria-hidden="true" /> Export CSV
            </Button>
          )}
        </div>
        <DataState
          status={statusOf(comparisons, rows.length === 0, 'no-data')}
          error={comparisons.error}
          noDataMessage="No data in this range."
        >
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">{label} daily results</caption>
              <thead className="bg-navy-800 text-label text-ink-muted">
                <tr>
                  {[
                    'Date',
                    'Day',
                    'Result',
                    'Preflight reference',
                    'Condition',
                    'Quality',
                    'Review',
                  ].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr
                    key={v.comparison.comparison_id}
                    className="border-t"
                    data-testid="detail-row"
                  >
                    <td className="px-3 py-2">{formatDate(v.daily_result.assessment_date)}</td>
                    <td className="px-3 py-2">{v.daily_result.mission_day}</td>
                    <td className="px-3 py-2">
                      {formatNumber(v.comparison.inflight_value, 1)}{' '}
                      {formatUnit(v.daily_result.metric_unit)}
                    </td>
                    <td className="px-3 py-2">
                      {v.baseline
                        ? `${formatNumber(v.baseline.reference_lower, 1)}–${formatNumber(v.baseline.reference_upper, 1)}`
                        : 'No reference'}
                    </td>
                    <td className="px-3 py-2">
                      {humanise(v.baseline?.assessment_condition)} ·{' '}
                      {humanise(v.comparison.comparison_method).toLowerCase()}
                    </td>
                    <td className="px-3 py-2">
                      {v.daily_result.valid_trials} valid trials ·{' '}
                      {v.daily_result.sessions_completed} session(s)
                    </td>
                    <td className="px-3 py-2">
                      {v.comparison.reference_range_status === 'within_reference' ? (
                        <span className="text-ink-muted">Within reference</span>
                      ) : (
                        <StatusBadge status="review" label="flagged for contextual review" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
    </div>
  );
}
