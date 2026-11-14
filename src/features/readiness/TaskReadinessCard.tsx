import { CheckCircle2, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { DataState } from '@/components/shared';
import { formatTimestamp, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReadinessCategory } from './config';
import { buildInsights, type InsightTone } from './insights';
import { ReadinessRing } from './ReadinessRing';
import type { CategoryResult } from './score';
import { useTaskReadiness } from './useTaskReadiness';

const CATEGORY_LABEL: Record<ReadinessCategory, string> = {
  recovery: 'Recovery & Sleep',
  vitals: 'Current Vitals',
  cognitive: 'Mission Mind',
};

const TONE: Record<InsightTone, { icon: LucideIcon; className: string; label: string }> = {
  positive: { icon: CheckCircle2, className: 'text-status-nominal', label: 'Supporting' },
  attention: { icon: TriangleAlert, className: 'text-status-review', label: 'Reducing' },
  neutral: { icon: Info, className: 'text-ink-muted', label: 'Note' },
};

function CategoryBar({ c }: { c: CategoryResult }) {
  const pct = c.score === null ? null : Math.round(c.score * 100);
  const used = c.factors.filter((f) => f.state === 'scored').length;
  return (
    <li className="space-y-1.5" data-testid="readiness-category" data-category={c.category}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink">{CATEGORY_LABEL[c.category]}</span>
        <span className="tabular-nums text-ink-muted">{pct === null ? 'No data' : `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-navy-700" aria-hidden="true">
        {pct !== null && (
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-300 transition-[width] duration-700 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <p className="text-caption text-ink-subtle">
        {used} of {c.factors.length} factors used · weight {Math.round(c.weight * 100)}%
      </p>
    </li>
  );
}

/** Task Readiness Score with its rule-based insights. */
export function TaskReadinessCard() {
  const { result, operational, isPending, isError, error, refetch } = useTaskReadiness();
  const insights = useMemo(() => (result ? buildInsights(result) : []), [result]);

  return (
    <section
      aria-labelledby="readiness-title"
      className="surface-glass relative overflow-hidden p-5 sm:p-6"
    >
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl"
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="readiness-title" className="text-title">
          Task Readiness Score
        </h2>
        {result && (
          <p className="text-caption text-ink-subtle">As of {formatTimestamp(result.asOf)}</p>
        )}
      </div>

      <DataState
        status={isPending ? 'loading' : isError ? 'error' : result ? 'ready' : 'no-data'}
        error={error}
        onRetry={refetch}
        noDataMessage="No data is available to estimate readiness yet."
      >
        {result && (
          <div className="mt-4 grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-2">
              <ReadinessRing
                percent={result.score}
                label={
                  result.score === null
                    ? 'Task readiness estimate unavailable: insufficient data'
                    : `Task readiness estimate ${result.score} percent`
                }
              />
              <p className="text-caption text-ink-muted" data-testid="readiness-status">
                {result.status === 'insufficient_data'
                  ? 'Insufficient data'
                  : `Prototype estimate · ${result.confidence} confidence`}
              </p>
            </div>
            <div className="space-y-4">
              <ul className="space-y-3">
                {result.categories.map((c) => (
                  <CategoryBar key={c.category} c={c} />
                ))}
              </ul>
              <p className="text-caption text-ink-subtle">
                Data coverage {Math.round(result.coverage * 100)}%. Demonstration weighting, not a
                clinical standard. This estimate is not medical clearance and does not decide task
                assignments.
              </p>
              <p className="text-caption text-ink-subtle" data-testid="operational-eligibility">
                Operational eligibility (decided separately):{' '}
                <span className="text-ink-muted">
                  {operational
                    ? humanise(operational.operational_eligibility_status)
                    : 'not reported'}
                </span>
              </p>
            </div>
          </div>
        )}
      </DataState>

      {result && (
        <div className="mt-6 border-t pt-5">
          <h3 id="insights-title" className="mb-3 text-title">
            Task Readiness Insights
          </h3>
          <ul aria-labelledby="insights-title" className="space-y-2" data-testid="insights">
            {insights.map((i) => {
              const tone = TONE[i.tone];
              const Icon = tone.icon;
              return (
                <li
                  key={i.id}
                  data-insight={i.id}
                  className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-navy-900/60 px-3 py-2.5 text-sm motion-safe:animate-fade-in"
                >
                  <Icon
                    className={cn('mt-0.5 h-4 w-4 shrink-0', tone.className)}
                    aria-hidden="true"
                  />
                  <span className="sr-only">{tone.label}: </span>
                  <span className="text-ink">{i.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
