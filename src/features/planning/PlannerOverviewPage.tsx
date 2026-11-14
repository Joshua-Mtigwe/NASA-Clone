import type { AssessmentCurrency } from '@/api/types';
import { DataState, PageHeader, StatusBadge, type Status } from '@/components/shared';
import { Card } from '@/components/ui/card';
import { formatDate, formatMinutes, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { useCrewOverview, usePlannerOverview, usePlanningDay } from './hooks';
import { DayNav } from './DayNav';

const CURRENCY: Record<AssessmentCurrency, { status: Status; label: string }> = {
  assessment_current: { status: 'nominal', label: 'Assessment current' },
  review_pending: { status: 'review', label: 'Review pending' },
  no_current_assessment: { status: 'no_data', label: 'No current assessment' },
};

function Kpi({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card className="p-4">
      <p className="text-caption uppercase text-ink-subtle">{label}</p>
      <p className="text-metric-sm text-ink" data-testid={testId}>
        {value}
      </p>
    </Card>
  );
}

/** Operational view for the mission leader. It shows no cognitive scores. */
export function PlannerOverviewPage() {
  const day = usePlanningDay();
  const overview = usePlannerOverview(day.date);
  const crew = useCrewOverview();
  const o = overview.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planner Overview"
        description="Crew availability and the day's planning workload."
        actions={<DayNav day={day} />}
      />

      <DataState
        status={statusOf(overview, !o)}
        error={overview.error}
        onRetry={() => void overview.refetch()}
      >
        {o && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Crew members" value={String(o.crew_members)} testId="kpi-crew" />
            <Kpi label="Tasks submitted" value={String(o.tasks_submitted)} testId="kpi-tasks" />
            <Kpi label="Pending review" value={String(o.pending_review)} testId="kpi-pending" />
            <Kpi
              label="Scheduled time"
              value={formatMinutes(o.scheduled_minutes)}
              testId="kpi-scheduled"
            />
          </div>
        )}
      </DataState>

      <section aria-labelledby="crew-title" className="space-y-3">
        <h2 id="crew-title" className="text-title">
          Crew operational overview
        </h2>
        <p className="text-sm text-ink-muted">
          Operational readiness only. Detailed cognitive results are not shown to mission planning.
        </p>
        <DataState
          status={statusOf(crew, (crew.data ?? []).length === 0)}
          error={crew.error}
          onRetry={() => void crew.refetch()}
        >
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <caption className="sr-only">Crew operational overview</caption>
              <thead className="bg-navy-800 text-label text-ink-muted">
                <tr>
                  {['Astronaut', 'Role', 'Availability', 'Qualifications', 'Assessment status'].map(
                    (h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(crew.data ?? []).map((c) => {
                  const cur = CURRENCY[c.assessment_status];
                  return (
                    <tr
                      key={c.astronaut.astronaut_id}
                      className="border-t align-top"
                      data-testid="crew-row"
                    >
                      <td className="px-3 py-2 text-ink">{c.astronaut.astronaut_code}</td>
                      <td className="px-3 py-2">{c.astronaut.crew_role}</td>
                      <td className="px-3 py-2">
                        {c.readiness ? (
                          <>
                            {humanise(c.readiness.operational_eligibility_status)}
                            <span className="block text-caption text-ink-subtle">
                              Limit {c.readiness.workload_limit_minutes} min · until{' '}
                              {formatDate(c.readiness.valid_until)}
                            </span>
                          </>
                        ) : (
                          'No data'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.qualifications.length === 0 ? (
                          'None recorded'
                        ) : (
                          <ul className="space-y-1">
                            {c.qualifications.map((q) => (
                              <li key={q.qualification_id}>
                                {q.qualification_code}
                                {q.authorization_status.includes('not_verified') && (
                                  <StatusBadge
                                    status="review"
                                    label="Unverified demonstration data"
                                    className="ml-2"
                                  />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={cur.status} label={cur.label} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataState>
      </section>
    </div>
  );
}
