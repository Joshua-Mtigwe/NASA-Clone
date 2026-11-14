import type { CognitiveBaselinesRow } from '@/types/tables';
import { DataState, PageHeader } from '@/components/shared';
import { Card } from '@/components/ui/card';
import { useAstronautContext } from '@/features/health/hooks';
import { formatDate, formatNumber, formatUnit, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { CONDITION_LABELS } from './battery/registry';
import { useBaselines } from './hooks';
import { DOMAIN_LABEL } from './results';

/** Personal preflight reference per domain and condition, exactly as the backend computed it. */
export function BaselinePage() {
  const { astronautId } = useAstronautContext();
  const baselines = useBaselines(astronautId);
  const rows = baselines.data ?? [];
  const domains = [...new Set(rows.map((r) => r.cognitive_domain))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Baseline profile"
        description="Your preflight reference for each cognitive domain, by session condition."
      />
      <DataState
        status={statusOf(baselines, rows.length === 0)}
        error={baselines.error}
        onRetry={() => void baselines.refetch()}
        emptyMessage="No baseline has been calculated yet."
      >
        <div className="space-y-4">
          {domains.map((domain) => {
            const list = rows.filter((r) => r.cognitive_domain === domain);
            const unit = formatUnit(list[0]?.metric_unit);
            return (
              <Card
                key={domain}
                className="p-5"
                role="region"
                aria-label={DOMAIN_LABEL[domain] ?? humanise(domain)}
              >
                <h2 className="text-title">{DOMAIN_LABEL[domain] ?? humanise(domain)}</h2>
                <p className="mb-3 text-caption text-ink-subtle">
                  {humanise(list[0]?.metric_name)}
                  {unit ? ` · ${unit}` : ''}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <caption className="sr-only">
                      {DOMAIN_LABEL[domain] ?? domain} baseline by condition
                    </caption>
                    <thead className="text-label text-ink-muted">
                      <tr>
                        <th scope="col" className="py-2 pr-3">
                          Condition
                        </th>
                        <th scope="col" className="py-2 pr-3">
                          Median
                        </th>
                        <th scope="col" className="py-2 pr-3">
                          Reference range
                        </th>
                        <th scope="col" className="py-2 pr-3">
                          Variability (SD)
                        </th>
                        <th scope="col" className="py-2 pr-3">
                          Valid observations
                        </th>
                        <th scope="col" className="py-2">
                          Version
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((b: CognitiveBaselinesRow) => (
                        <tr key={b.baseline_id} className="border-t" data-testid="baseline-row">
                          <td className="py-2 pr-3 text-ink">
                            {CONDITION_LABELS[b.assessment_condition] ??
                              humanise(b.assessment_condition)}
                          </td>
                          <td className="py-2 pr-3 text-ink">
                            {formatNumber(b.median_value, 1)} {unit}
                          </td>
                          <td className="py-2 pr-3 text-ink">
                            {formatNumber(b.reference_lower, 1)}–
                            {formatNumber(b.reference_upper, 1)} {unit}
                          </td>
                          <td className="py-2 pr-3 text-ink">
                            ± {formatNumber(b.standard_deviation, 2)}
                          </td>
                          <td className="py-2 pr-3 text-ink">n = {b.sample_size}</td>
                          <td className="py-2 text-ink-muted">
                            {b.baseline_version} · {formatDate(b.calculated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      </DataState>
    </div>
  );
}
