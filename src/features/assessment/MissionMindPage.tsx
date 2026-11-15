import { CheckCircle2, Circle, Flame, Gamepad2, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router';
import { DataState, PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAstronautContext } from '@/features/health/hooks';
import { formatDate } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { MISSION_MIND_GAMES } from './battery/registry';
import { useDueAssessments, useMissionMindSummary } from './hooks';
import { canStart } from './gating';
import { describeResult, DOMAIN_LABEL } from './results';

export function MissionMindPage() {
  const { astronautId } = useAstronautContext();
  const summary = useMissionMindSummary(astronautId);
  const due = useDueAssessments(astronautId);
  const s = summary.data;
  const missionDue = (due.data ?? []).filter((d) => d.mission_phase === 'inflight');
  const checkIn = missionDue.find((d) => d.protocol.protocol_id === 'SURVEY');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mission Mind"
        description="Your daily mission games. Same tests and scoring as the preflight battery, in a mission skin."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/astronaut/preflight">Preflight sessions</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/astronaut/baseline">Baseline profile</Link>
            </Button>
          </div>
        }
      />

      <DataState
        status={statusOf(summary, !s)}
        error={summary.error}
        onRetry={() => void summary.refetch()}
      >
        {s && (
          <>
            <Card
              className="relative grid gap-4 overflow-hidden border-accent/30 bg-gradient-to-br from-navy-850 via-navy-900 to-indigo-950/60 p-5 shadow-glow sm:grid-cols-3"
              role="region"
              aria-label="Today's session"
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl"
                aria-hidden="true"
              />
              <div>
                <p className="text-caption uppercase text-ink-subtle">
                  Today · {formatDate(s.date)}
                </p>
                <p className="text-title text-ink" data-testid="session-status">
                  {s.sessions_completed_today} of {s.sessions_scheduled_today} complete
                </p>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-700"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-[width] duration-700 motion-reduce:transition-none"
                    style={{
                      width: `${s.sessions_scheduled_today ? Math.min(100, (s.sessions_completed_today / s.sessions_scheduled_today) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Timer className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                <p className="text-ink" data-testid="estimate">
                  About {Math.round(s.estimate_seconds / 60)} min
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-amber-300" aria-hidden="true" />
                <p className="text-ink" data-testid="streak">
                  {s.streak_days} {s.streak_days === 1 ? 'day' : 'days'} in a row
                </p>
              </div>
            </Card>

            <section aria-labelledby="games-title" className="space-y-3">
              <h2 id="games-title" className="text-title">
                Games
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {s.games.map((g) => {
                  const meta = MISSION_MIND_GAMES[g.protocol_id];
                  const d = missionDue.find((x) => x.assignment.assignment_id === g.assignment_id);
                  return (
                    <li key={g.protocol_id}>
                      <Card
                        className={cn(
                          'hover-lift relative flex h-full flex-col gap-2 overflow-hidden p-4',
                          g.completed_today && 'border-status-nominal/30',
                          !g.completed_today && g.scheduled_today && 'border-accent/40',
                        )}
                        data-testid="game-card"
                        aria-label={meta?.name ?? g.protocol_name}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="flex items-center gap-2 font-medium text-ink">
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400/25 to-violet-500/25 ring-1 ring-white/10"
                              aria-hidden="true"
                            >
                              <Gamepad2 className="h-4 w-4 text-cyan-200" />
                            </span>
                            {meta?.name ?? g.protocol_name}
                          </h3>
                          {g.completed_today ? (
                            <span className="inline-flex items-center gap-1 text-label text-status-nominal">
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Done today
                            </span>
                          ) : g.scheduled_today ? (
                            <span className="inline-flex items-center gap-1 text-label text-accent-strong">
                              <Circle className="h-4 w-4" aria-hidden="true" /> Today
                            </span>
                          ) : (
                            <span className="text-label text-ink-subtle">Not scheduled today</span>
                          )}
                        </div>
                        <p className="text-caption text-ink-subtle">
                          {meta?.skill} · {g.sessions_completed_total} sessions completed
                        </p>
                        {d &&
                          !g.completed_today &&
                          (canStart(d) ? (
                            <Button asChild size="sm" className="mt-auto self-start">
                              <Link
                                to={`/astronaut/cognition/mission-mind/${d.assignment.assignment_id}`}
                              >
                                Play
                              </Link>
                            </Button>
                          ) : (
                            <p className="mt-auto text-caption text-ink-muted">
                              {d.blocking_reason}
                            </p>
                          ))}
                      </Card>
                    </li>
                  );
                })}
              </ul>
              {checkIn && canStart(checkIn) && (
                <Button asChild variant="outline" size="sm">
                  <Link
                    to={`/astronaut/cognition/mission-mind/${checkIn.assignment.assignment_id}`}
                  >
                    Daily check-in
                  </Link>
                </Button>
              )}
            </section>

            <section aria-labelledby="today-results-title" className="space-y-3">
              <h2 id="today-results-title" className="text-title">
                Today by domain
              </h2>
              {s.results_today.length === 0 ? (
                <DataState status="empty" emptyMessage="No games completed today yet." />
              ) : (
                <ul className="grid gap-3 md:grid-cols-2" data-testid="domain-summary">
                  {s.results_today.map((r) => {
                    const d = describeResult(r);
                    return (
                      <li key={r.result_id}>
                        <Card className="surface-glass p-4">
                          <p className="text-caption uppercase text-accent-strong">
                            {DOMAIN_LABEL[r.cognitive_domain] ?? r.cognitive_domain}
                          </p>
                          <p className="text-ink">
                            {d.label}: <span className="font-medium">{d.value}</span>
                          </p>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-caption text-ink-subtle">
                Each domain is reported in its own unit. There is no combined score.
              </p>
            </section>
          </>
        )}
      </DataState>
    </div>
  );
}
