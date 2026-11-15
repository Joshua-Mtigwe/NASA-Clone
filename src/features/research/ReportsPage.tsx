import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';
import { isApiError } from '@/api/client';
import { researchApi } from '@/api/research';
import { DataState, PageHeader } from '@/components/shared';
import { Card } from '@/components/ui/card';
import { statusOf } from '@/lib/queryState';
import { useAnalyses } from './hooks';

export function ReportsPage() {
  const analyses = useAnalyses();
  const list = analyses.data ?? [];
  const reports = useQueries({
    queries: list.map((a) => ({
      queryKey: ['research', 'report', a.analysis_id],
      queryFn: async () => {
        try {
          return await researchApi.analysisReport(a.analysis_id);
        } catch (e) {
          if (isApiError(e) && e.kind === 'not_found') return null;
          throw e;
        }
      },
    })),
  });
  const drafted = list.flatMap((a, i) => (reports[i]?.data ? [{ a, r: reports[i]!.data! }] : []));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Plain-language summaries from computed results. Each one is exploratory."
      />
      <DataState
        status={statusOf(analyses, drafted.length === 0)}
        error={analyses.error}
        emptyMessage="No analysis has been run yet, so there are no reports."
      >
        <ul className="space-y-3">
          {drafted.map(({ a, r }) => (
            <li key={r.report_id}>
              <Card className="space-y-1 p-4" data-testid="report-item">
                <Link
                  to={`/research/analyses/${a.analysis_id}`}
                  className="font-medium text-accent-strong underline-offset-4 hover:underline"
                >
                  {r.title}
                </Link>
                <p className="text-caption text-status-review">
                  {r.model_id && !r.model_id.includes('template')
                    ? 'AI-drafted from computed results'
                    : 'Report from computed results'}
                </p>
                <p className="line-clamp-2 text-sm text-ink-muted">{r.report_text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </DataState>
    </div>
  );
}
