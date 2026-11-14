import type { DailyCognitiveResultsRow } from '@/types/tables';
import { callEndpoint } from './client';
import type { CognitionQuery, CognitionSummary, CognitiveComparisonView } from './types';

export const cognitionApi = {
  dailyResults: (query: CognitionQuery) =>
    callEndpoint<DailyCognitiveResultsRow[]>('cognition.dailyResults', {}, { query }),
  comparisons: (query: CognitionQuery) =>
    callEndpoint<CognitiveComparisonView[]>('cognition.comparisons', {}, { query }),
  /** Per-domain medians, variability, distribution values and daily completion. */
  summary: (query: CognitionQuery) =>
    callEndpoint<CognitionSummary>('cognition.summary', {}, { query }),
};
