import type {
  AnalysisJobsRow,
  AnalysisResultsRow,
  ResearchAnalysesRow,
  ResearchReportsRow,
} from '@/types/tables';
import { callEndpoint } from './client';
import type {
  AnalysisChart,
  AnalysisStatus,
  AnalysisView,
  CreateAnalysisRequest,
  PlanningComparison,
  ResearchOverview,
  ResearchVariable,
} from './types';

export const researchApi = {
  overview: () => callEndpoint<ResearchOverview>('research.overview'),
  variables: () => callEndpoint<ResearchVariable[]>('research.variables'),
  listAnalyses: () => callEndpoint<ResearchAnalysesRow[]>('research.listAnalyses'),
  /** Queues an analysis job. Poll getAnalysis until job.status is "completed". */
  createAnalysis: (body: CreateAnalysisRequest) =>
    callEndpoint<AnalysisJobsRow>('research.createAnalysis', {}, { body }),
  getAnalysis: (analysisId: string) =>
    callEndpoint<AnalysisStatus>('research.getAnalysis', { analysisId }),
  analysisResults: (analysisId: string) =>
    callEndpoint<AnalysisResultsRow[]>('research.analysisResults', { analysisId }),
  analysisCharts: (analysisId: string, view: AnalysisView = 'within_person') =>
    callEndpoint<AnalysisChart[]>('research.analysisCharts', { analysisId }, { query: { view } }),
  /** 404 until a report has been drafted. */
  analysisReport: (analysisId: string) =>
    callEndpoint<ResearchReportsRow>('research.analysisReport', { analysisId }),
  planningComparison: () => callEndpoint<PlanningComparison>('research.planningComparison'),
};
