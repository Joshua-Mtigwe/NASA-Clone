import type { AnalysisChart, AnalysisQuestionType } from '@/api/types';

export const QUESTION_TYPES: Array<{ key: AnalysisQuestionType; label: string }> = [
  { key: 'longitudinal', label: 'Longitudinal trend' },
  { key: 'scatter', label: 'Scatter (association)' },
  { key: 'lagged_comparison', label: 'Lagged comparison (previous day)' },
  { key: 'domain_heatmap', label: 'Domain heatmap' },
  { key: 'paired_preflight_inflight', label: 'Paired preflight and inflight' },
  { key: 'individual_trajectories', label: 'Individual trajectories' },
];

export function uncertaintyText(c: AnalysisChart): string {
  const missing = `Missing: ${c.missing.n_missing} of ${c.missing.n_total} observations`;
  if (c.effect_estimate === null) return `Descriptive only, no effect estimate · ${missing}`;
  const ci =
    c.confidence_interval_lower !== null
      ? ` (95% CI ${c.confidence_interval_lower} to ${c.confidence_interval_upper})`
      : ' (no confidence interval reported)';
  return `Association r = ${c.effect_estimate}${ci} · ${missing}`;
}
