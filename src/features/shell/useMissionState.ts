import { useQuery } from '@tanstack/react-query';
import { missionsApi } from '@/api/missions';
import { queryKeys } from '@/app/queryClient';

/**
 * One shared query for mission state. Every component that needs the mission day,
 * clock or simulation run reads this cache, so values stay consistent across
 * navigation. Phase 8 replaces polling with WebSocket updates.
 */
export function useMissionState() {
  return useQuery({
    queryKey: queryKeys.missionState,
    queryFn: () => missionsApi.currentState(),
    refetchInterval: 30_000,
  });
}
