import type { AssessmentResultsRow } from '@/types/tables';
import { formatNumber, formatUnit, humanise } from '@/lib/format';

const METRIC_LABEL: Record<string, string> = {
  median_reaction_time_ms: 'Median reaction time',
  accuracy_percent: 'Accuracy',
  correct_responses_per_minute: 'Correct responses per minute',
  fatigue_score: 'Fatigue score',
};

const UNIT_LABEL: Record<string, string> = { per_min: 'per min', '1-9': 'on a 1–9 scale' };

/** Display one backend score in its own unit, e.g. "Median reaction time: 320 ms". */
export function describeResult(r: AssessmentResultsRow): { label: string; value: string } {
  const unit = UNIT_LABEL[r.metric_unit] ?? formatUnit(r.metric_unit);
  return {
    label: METRIC_LABEL[r.metric_name] ?? humanise(r.metric_name),
    value: `${formatNumber(r.metric_value, 1)}${unit ? ` ${unit}` : ''}`,
  };
}

export const DOMAIN_LABEL: Record<string, string> = {
  vigilance: 'Vigilance',
  working_memory: 'Working memory',
  attention: 'Attention',
  processing_speed: 'Processing speed',
  spatial_reasoning: 'Spatial reasoning',
  reasoning: 'Reasoning',
  cognitive_flexibility: 'Cognitive flexibility',
  subjective_fatigue: 'Subjective fatigue',
};
