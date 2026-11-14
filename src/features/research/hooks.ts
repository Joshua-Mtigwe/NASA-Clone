import { useQuery } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { researchApi } from '@/api/research';
import type { AnalysisView } from '@/api/types';

/** Poll interval while an analysis job runs (ms). */
export const ANALYSIS_POLL_MS = 300;

export const useResearchOverview = () =>
  useQuery({ queryKey: ['research', 'overview'], queryFn: () => researchApi.overview() });
export const useVariables = () =>
  useQuery({
    queryKey: ['research', 'variables'],
    queryFn: () => researchApi.variables(),
    staleTime: 10 * 60_000,
  });
export const useAnalyses = () =>
  useQuery({ queryKey: ['research', 'analyses'], queryFn: () => researchApi.listAnalyses() });

export function useAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: ['research', 'analysis', id],
    queryFn: () => researchApi.getAnalysis(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === 'queued' || status === 'running' ? ANALYSIS_POLL_MS : false;
    },
  });
}

export function useCharts(id: string | undefined, view: AnalysisView, ready: boolean) {
  return useQuery({
    queryKey: ['research', 'charts', id, view],
    queryFn: () => researchApi.analysisCharts(id!, view),
    enabled: !!id && ready,
  });
}

/** The drafted report, or null while none exists (404). */
export function useReport(id: string | undefined, ready: boolean) {
  return useQuery({
    queryKey: ['research', 'report', id],
    queryFn: async () => {
      try {
        return await researchApi.analysisReport(id!);
      } catch (e) {
        if (isApiError(e) && e.kind === 'not_found') return null;
        throw e;
      }
    },
    enabled: !!id && ready,
  });
}

export const usePlanningComparison = () =>
  useQuery({
    queryKey: ['research', 'planning-comparison'],
    queryFn: () => researchApi.planningComparison(),
  });
