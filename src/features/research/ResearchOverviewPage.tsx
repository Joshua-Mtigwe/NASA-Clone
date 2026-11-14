import { Link } from 'react-router';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { useResearchOverview } from './hooks';

export function ResearchOverviewPage() {
  const overview = useResearchOverview();
  const o = overview.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Research Overview"
        description="The dataset available for exploratory analysis. Participants are pseudonymised."
        actions={
          <Button asChild>
            <Link to="/research/analyses">New analysis</Link>
          </Button>
        }
      />
      <StatusBadge status="review" label="Synthetic demonstration data: findings are exploratory" />
      <DataState
        status={statusOf(overview, !o)}
        error={overview.error}
        onRetry={() => void overview.refetch()}
      >
        {o && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Participants', o.participants, 'kpi-participants'],
                ['Assessment sessions', o.assessment_sessions, 'kpi-sessions'],
                ['Mission days with data', o.mission_days, 'kpi-days'],
              ].map(([label, value, id]) => (
                <Card key={String(id)} className="p-4">
                  <p className="text-caption uppercase text-ink-subtle">{label}</p>
                  <p className="text-metric-sm text-ink" data-testid={String(id)}>
                    {value}
                  </p>
                </Card>
              ))}
            </div>
            <Card className="space-y-2 p-4" role="region" aria-label="Data quality">
              <h2 className="text-title">Data quality</h2>
              <ul className="text-sm" data-testid="quality">
                {Object.entries(o.sessions_by_quality).map(([q, n]) => (
                  <li key={q}>
                    {humanise(q)}: <span className="text-ink">{n}</span> sessions
                  </li>
                ))}
              </ul>
              <p className="text-caption text-ink-subtle">
                Participants: {o.participant_ids.join(', ')}
              </p>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}
