import type { ReadinessFactor } from '@/api/types';
import { DataState, MeasurementCard, PageHeader, type Status } from '@/components/shared';
import { formatUnit } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { CognitiveSnapshot } from './CognitiveSnapshot';
import { MEASURE_ORDER, MEASURES, shiftDate } from './config';
import {
  useAstronautContext,
  useComparisons,
  useHealthSummary,
  useReadinessSummary,
} from './hooks';
import { ReadinessSummaryCard } from './ReadinessSummaryCard';

/** Backend reference status -> card badge. The card never derives one itself. */
function cardStatus(factor: ReadinessFactor | undefined): Status | undefined {
  if (!factor) return undefined;
  if (factor.reference_range_status === 'within_reference') return 'nominal';
  if (factor.reference_range_status === 'outside_reference') return 'review';
  return undefined;
}

export function OverviewPage() {
  const { astronautId, missionDate, missionTime } = useAstronautContext();
  const summary = useHealthSummary(astronautId);
  const readiness = useReadinessSummary(astronautId);
  const comparisonRange =
    missionDate && missionTime ? { from: shiftDate(missionDate, -7), to: missionDate } : null;
  const comparisons = useComparisons(astronautId, comparisonRange);

  const measurements = summary.data?.measurements ?? [];
  const factors = readiness.data?.factors ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Your latest measurements, daily readiness factors and cognitive snapshot."
      />

      <DataState
        status={statusOf(readiness, !readiness.data)}
        error={readiness.error}
        onRetry={() => void readiness.refetch()}
      >
        {readiness.data && <ReadinessSummaryCard summary={readiness.data} />}
      </DataState>

      <section aria-labelledby="measurements-title" className="space-y-3">
        <h2 id="measurements-title" className="text-title">
          Latest measurements
        </h2>
        <DataState
          status={statusOf(summary, measurements.length === 0)}
          error={summary.error}
          onRetry={() => void summary.refetch()}
          emptyMessage="No measurements have been recorded yet."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MEASURE_ORDER.map((measure) => {
              const m = measurements.find((x) => x.measure === measure);
              const meta = MEASURES[measure];
              return (
                <MeasurementCard
                  key={measure}
                  label={meta.label}
                  value={m?.value}
                  unit={formatUnit(m?.unit)}
                  measuredAt={m?.measured_at}
                  source={m?.source_type ? `${m.source_type} · ${m.source_id ?? ''}` : null}
                  quality={m?.quality_status}
                  provenance={m?.provenance}
                  status={cardStatus(factors.find((f) => f.factor === measure))}
                  fractionDigits={meta.fractionDigits}
                />
              );
            })}
          </div>
        </DataState>
      </section>

      {missionTime && (
        <CognitiveSnapshot
          comparisons={comparisons.data}
          query={comparisons}
          missionTime={missionTime}
        />
      )}
    </div>
  );
}
