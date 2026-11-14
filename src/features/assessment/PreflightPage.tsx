import { Link } from 'react-router';
import type { DueAssessment } from '@/api/types';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAstronautContext } from '@/features/health/hooks';
import { statusOf } from '@/lib/queryState';
import { CONDITION_LABELS } from './battery/registry';
import { canStart } from './gating';
import { useDueAssessments } from './hooks';
import { useOutboxStatus } from './offline/queue';

export function DueRow({ d, href }: { d: DueAssessment; href: string }) {
  const ready = canStart(d);
  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4" data-testid="due-session">
      <div className="min-w-48 flex-1">
        <h3 className="font-medium text-ink">{d.protocol.protocol_name}</h3>
        <p className="text-caption text-ink-subtle">
          About {Math.max(1, Math.round(d.protocol.duration_seconds / 60))} min · version{' '}
          {d.protocol.protocol_version}
        </p>
      </div>
      <span
        className="rounded border px-2 py-0.5 text-caption text-ink-muted"
        data-testid="condition-tag"
      >
        {CONDITION_LABELS[d.assignment.assessment_condition] ?? d.assignment.assessment_condition}
      </span>
      {ready ? (
        <StatusBadge status="nominal" label="Ready" />
      ) : (
        <StatusBadge
          status="review"
          label={d.authorized ? 'Conditions not met' : 'Waiting for access'}
        />
      )}
      {d.blocking_reason && (
        <p className="w-full text-caption text-ink-muted">{d.blocking_reason}</p>
      )}
      {ready ? (
        <Button asChild size="sm">
          <Link to={href}>Start</Link>
        </Button>
      ) : (
        <Button size="sm" disabled aria-describedby={undefined}>
          Start
        </Button>
      )}
    </Card>
  );
}

export function PreflightPage() {
  const { astronautId } = useAstronautContext();
  const due = useDueAssessments(astronautId);
  const outbox = useOutboxStatus();
  const items = (due.data ?? []).filter((d) => d.mission_phase === 'preflight');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preflight sessions"
        description="Baseline sessions. Each one opens only when it is authorised and its conditions are met."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/astronaut/baseline">Baseline profile</Link>
          </Button>
        }
      />
      {outbox.pending > 0 && (
        <p role="status" className="text-sm text-status-review">
          {outbox.pending} item(s) saved on this device are waiting to sync.
        </p>
      )}
      <DataState
        status={statusOf(due, items.length === 0)}
        error={due.error}
        onRetry={() => void due.refetch()}
        emptyMessage="No preflight sessions are due."
      >
        <ul className="space-y-3">
          {items.map((d) => (
            <li key={d.assignment.assignment_id}>
              <DueRow d={d} href={`/astronaut/preflight/${d.assignment.assignment_id}`} />
            </li>
          ))}
        </ul>
      </DataState>
    </div>
  );
}
