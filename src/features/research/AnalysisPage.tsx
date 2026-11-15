import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isMockMode } from '@/config/env';
import { researchApi } from '@/api/research';
import { Bot } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { AnalysisView } from '@/api/types';
import { DataState, PageHeader, StatusBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate, formatTimestamp, humanise } from '@/lib/format';
import { statusOf } from '@/lib/queryState';
import { AnalysisChartView } from './AnalysisChartView';
import { useAnalysis, useCharts, useReport } from './hooks';

export const EXPLORATORY_LINE = 'Associations are exploratory and are not evidence of cause.';

export function AnalysisPage() {
  const { analysisId } = useParams();
  const queryClient = useQueryClient();
  const draft = useMutation({
    mutationFn: () => researchApi.draftReport(analysisId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['research', 'report', analysisId] });
    },
  });
  const [view, setView] = useState<AnalysisView>('within_person');
  const status = useAnalysis(analysisId);
  const job = status.data?.job ?? null;
  const done = job?.status === 'completed';
  const charts = useCharts(analysisId, view, done);
  const report = useReport(analysisId, done);
  const a = status.data?.analysis;

  return (
    <div className="space-y-6">
      <PageHeader
        title={a?.research_question ?? 'Analysis'}
        description={
          a
            ? `${humanise(a.analysis_type)} · ${humanise(a.dependent_variable)} by ${humanise(a.independent_variable)} · ${formatDate(a.date_range_start)} to ${formatDate(a.date_range_end)}`
            : undefined
        }
      />

      <DataState status={statusOf(status, !status.data)} error={status.error}>
        {!job ? (
          <DataState status="empty" emptyMessage="No analysis has been run yet" />
        ) : !done ? (
          <p role="status" className="text-ink-muted" data-testid="job-status">
            Analysis {job.status}…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label="View" className="flex gap-1 rounded-md border p-1">
                {(['within_person', 'pooled'] as const).map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    role="radio"
                    aria-checked={view === v}
                    variant={view === v ? 'default' : 'ghost'}
                    onClick={() => setView(v)}
                  >
                    {v === 'within_person' ? 'Within-person' : 'Pooled'}
                  </Button>
                ))}
              </div>
              <StatusBadge status="review" label="Exploratory, synthetic data" />
            </div>

            <DataState
              status={statusOf(charts, (charts.data ?? []).length === 0, 'no-data')}
              error={charts.error}
              noDataMessage="No data: the analysis returned no chart."
            >
              <div className="space-y-4">
                {(charts.data ?? []).map((c) => (
                  <AnalysisChartView key={`${c.chart_id}-${c.view}`} chart={c} />
                ))}
              </div>
            </DataState>

            <Card className="space-y-2 p-5" role="region" aria-label="Report">
              <h2 className="flex flex-wrap items-center gap-2 text-title">
                <Bot className="h-5 w-5 text-accent" aria-hidden="true" /> Report
                <span className="rounded border border-status-review/50 px-1.5 py-0.5 text-caption text-status-review">
                  {report.data?.model_id && !report.data.model_id.includes('template')
                    ? 'AI-drafted from computed results'
                    : 'Report from computed results'}
                </span>
              </h2>
              {!isMockMode && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={draft.isPending}
                    onClick={() => draft.mutate()}
                  >
                    {draft.isPending ? 'Drafting…' : 'Ask Gemma to draft report'}
                  </Button>
                  {draft.data?.note && (
                    <p role="status" className="text-sm text-ink-muted">
                      {draft.data.note}
                    </p>
                  )}
                  {draft.isError && <p role="alert">{draft.error.message}</p>}
                </div>
              )}
              <DataState
                status={statusOf(report, !report.data, 'empty')}
                error={report.error}
                emptyMessage="No report has been drafted for this analysis yet."
              >
                {report.data && (
                  <>
                    <p className="text-ink">{report.data.report_text}</p>
                    <p className="text-caption text-ink-subtle">
                      {report.data.model_id} · {humanise(report.data.status)} ·{' '}
                      {formatTimestamp(report.data.created_at)} · not yet reviewed
                    </p>
                  </>
                )}
              </DataState>
              <p className="text-sm text-ink-muted" data-testid="exploratory-line">
                {EXPLORATORY_LINE}
              </p>
            </Card>
          </>
        )}
      </DataState>
    </div>
  );
}
