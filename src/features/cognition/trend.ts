import type { CognitiveComparisonView } from '@/api/types';

export interface TrendPoint {
  date: string;
  value: number;
  band: [number, number] | null;
  flagged: boolean;
  condition: string;
}

export function toTrendPoints(views: CognitiveComparisonView[]): TrendPoint[] {
  return [...views]
    .sort((a, b) => a.daily_result.assessment_date.localeCompare(b.daily_result.assessment_date))
    .map((v) => ({
      date: v.daily_result.assessment_date,
      value: v.comparison.inflight_value,
      band: v.baseline ? [v.baseline.reference_lower, v.baseline.reference_upper] : null,
      flagged: v.comparison.reference_range_status !== 'within_reference',
      condition: v.baseline?.assessment_condition ?? 'unknown',
    }));
}
