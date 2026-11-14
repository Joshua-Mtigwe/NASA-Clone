import { useQuery } from '@tanstack/react-query';
import { assessmentsApi } from '@/api/assessments';
import { astronautsApi } from '@/api/astronauts';

export function useDueAssessments(astronautId: string | null) {
  return useQuery({
    queryKey: ['assessments', 'due', astronautId],
    queryFn: () => assessmentsApi.due(astronautId!),
    enabled: !!astronautId,
  });
}

export function useMissionMindSummary(astronautId: string | null) {
  return useQuery({
    queryKey: ['assessments', 'mission-mind', astronautId],
    queryFn: () => assessmentsApi.missionMindSummary(astronautId!),
    enabled: !!astronautId,
  });
}

export function useBaselines(astronautId: string | null) {
  return useQuery({
    queryKey: ['astronauts', astronautId, 'baselines'],
    queryFn: () => astronautsApi.baselines(astronautId!),
    enabled: !!astronautId,
  });
}
