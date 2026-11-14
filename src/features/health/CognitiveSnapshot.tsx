import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { CognitiveComparisonView } from '@/api/types';
import { DataState, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate, formatNumber, formatUnit, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { COGNITIVE_DOMAINS } from './config';

type DomainKey = (typeof COGNITIVE_DOMAINS)[number]['key'];

interface Props {
  comparisons: CognitiveComparisonView[] | undefined;
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  /** Results calculated after the mission clock are not shown. */
  missionTime: string;
}

/** Latest backend comparison for a domain at or before the mission clock. */
function latestFor(views: CognitiveComparisonView[], domain: DomainKey, missionTime: string) {
  return views
    .filter(
      (v) =>
        v.daily_result.cognitive_domain === domain && v.comparison.calculated_at <= missionTime,
    )
    .sort((a, b) => b.comparison.calculated_at.localeCompare(a.comparison.calculated_at))[0];
}

/** Each domain in its own unit, compared with its own preflight reference. */
export function CognitiveSnapshot({ comparisons, query, missionTime }: Props) {
  const [domain, setDomain] = useState<DomainKey>('vigilance');
  const view = comparisons ? latestFor(comparisons, domain, missionTime) : undefined;
  const label = COGNITIVE_DOMAINS.find((d) => d.key === domain)!.label;

  return (
    <Card className="space-y-4 p-5" role="region" aria-labelledby="cognitive-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cognitive-title" className="text-title">
          Cognitive snapshot
        </h2>
        <Button asChild variant="link" className="h-auto p-0">
          <Link to="/astronaut/cognitive-trends">
            View cognitive trends <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <div role="group" aria-label="Cognitive domain" className="flex flex-wrap gap-2">
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

      <DataState
        status={statusOf(query, !view, 'no-data')}
        error={query.error}
        onRetry={() => void query.refetch()}
        noDataMessage={`No data: there is no ${label.toLowerCase()} result yet.`}
      >
        {view && <SnapshotDetail view={view} label={label} />}
      </DataState>
    </Card>
  );
}

function SnapshotDetail({ view, label }: { view: CognitiveComparisonView; label: string }) {
  const { comparison: c, daily_result: r, baseline: b } = view;
  const unit = formatUnit(r.metric_unit);
  const within = c.reference_range_status === 'within_reference';
  return (
    <div className="space-y-3" data-testid="cognitive-detail">
      <p className="text-caption text-ink-subtle">
        {label} · {humanise(r.metric_name)} · latest result {formatDate(r.assessment_date)} (mission
        day {r.mission_day})
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-metric">{formatNumber(c.inflight_value, 1)}</span>
        <span className="text-ink-muted">{unit}</span>
        <span className="ml-2 rounded border border-accent/40 px-1.5 py-0.5 text-caption text-accent-strong">
          Measured
        </span>
      </p>
      <p className="text-sm text-ink-muted">
        {b ? (
          <>
            Preflight reference {formatNumber(b.reference_lower, 1)}–
            {formatNumber(b.reference_upper, 1)} {unit} (n = {b.sample_size},{' '}
            {humanise(b.assessment_condition).toLowerCase()} sessions, baseline {b.baseline_version}
            ) · matched by {humanise(c.comparison_method).toLowerCase()}
          </>
        ) : (
          'No preflight reference is available for this result.'
        )}
      </p>
      <StatusBadge
        status={within ? 'nominal' : 'review'}
        label={within ? 'Within preflight reference' : 'Flagged for contextual review'}
      />
    </div>
  );
}
