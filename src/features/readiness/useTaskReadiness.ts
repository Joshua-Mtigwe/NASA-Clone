import { useMemo } from 'react';
import { shiftDate } from '@/features/health/config';
import {
  useAstronautContext,
  useComparisons,
  useHealthSummary,
  useReadinessSummary,
  useSleep,
} from '@/features/health/hooks';
import { computeTaskReadiness, type TaskReadiness } from './score';

/**
 * Gathers the backend inputs for the selected astronaut and computes the estimate.
 * Reuses the cached health queries, so no extra requests are made for animation.
 */
export function useTaskReadiness() {
  const { astronautId, missionDate, missionTime } = useAstronautContext();
  const summary = useReadinessSummary(astronautId);
  const health = useHealthSummary(astronautId);
  const sleepRange =
    missionDate && missionTime
      ? { from: `${shiftDate(missionDate, -3)}T00:00:00Z`, to: missionTime }
      : null;
  const sleep = useSleep(astronautId, sleepRange);
  const cogRange = missionDate ? { from: shiftDate(missionDate, -7), to: missionDate } : null;
  const comparisons = useComparisons(astronautId, cogRange);

  const queries = [summary, health, sleep, comparisons];
  const isPending = !!astronautId && queries.some((q) => q.isPending);
  const error = queries.find((q) => q.isError)?.error ?? null;

  const result = useMemo<TaskReadiness | null>(() => {
    if (!missionTime || !summary.data || !health.data || !sleep.data || !comparisons.data) {
      return null;
    }
    return computeTaskReadiness({
      asOf: missionTime,
      summary: summary.data,
      health: health.data,
      sleep: sleep.data,
      comparisons: comparisons.data,
    });
  }, [missionTime, summary.data, health.data, sleep.data, comparisons.data]);

  return {
    result,
    operational: summary.data?.operational ?? null,
    isPending,
    isError: !!error && !result,
    error,
    refetch: () => queries.forEach((q) => void q.refetch()),
  };
}
