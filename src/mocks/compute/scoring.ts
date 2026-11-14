/** Mock stand-in for backend assessment scoring. The UI never calls this. */
import type { AssessmentResultsRow, AssessmentTrialsRow } from '@/types/tables';
import { nextId, table } from '../db';

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * protocol_id -> cognitive_domain. PVT, NBACK, STROOP and SURVEY match
 * daily_cognitive_results.csv; the rest are assumptions for protocols with no results.
 */
export const PROTOCOL_DOMAIN: Record<string, string> = {
  PVT: 'vigilance',
  NBACK: 'working_memory',
  STROOP: 'attention',
  SURVEY: 'subjective_fatigue',
  SWITCH: 'cognitive_flexibility',
  SYMBOL: 'processing_speed',
  ROTATION: 'spatial_reasoning',
  REASONING: 'reasoning',
};

const UNIT: Record<string, string> = {
  median_reaction_time_ms: 'ms',
  accuracy_percent: 'percent',
  fatigue_score: '1-9',
  correct_responses_per_minute: 'per_min',
};

export async function scoreSession(
  sessionId: string,
  protocolId: string,
  trials: AssessmentTrialsRow[],
  fatigueScore: number | null,
  calculatedAt: string,
): Promise<AssessmentResultsRow[]> {
  const protocol = (await table('assessment_protocols')).find((p) => p.protocol_id === protocolId);
  const domain = PROTOCOL_DOMAIN[protocolId];
  if (!protocol || !domain) return [];
  const metric = protocol.scoring_method;
  const answered = trials.filter((t) => t.is_false_start === 0);

  let value: number | null = null;
  if (metric === 'median_reaction_time_ms') {
    value = median(
      answered.filter((t) => t.actual_response !== 'none').map((t) => t.reaction_time_ms),
    );
  } else if (metric === 'accuracy_percent') {
    value = trials.length
      ? (100 * trials.filter((t) => t.is_correct === 1).length) / trials.length
      : null;
  } else if (metric === 'correct_responses_per_minute') {
    const minutes = answered.reduce((sum, t) => sum + Math.max(t.reaction_time_ms, 0), 0) / 60_000;
    value = minutes > 0 ? trials.filter((t) => t.is_correct === 1).length / minutes : null;
  } else if (metric === 'fatigue_score') {
    value = fatigueScore;
  }
  if (value === null) return [];

  return [
    {
      result_id: nextId('RES'),
      session_id: sessionId,
      cognitive_domain: domain,
      metric_name: metric,
      metric_value: round2(value),
      metric_unit: UNIT[metric] ?? '',
      scoring_version: 'mock_v1',
      calculated_at: calculatedAt,
    },
  ];
}
