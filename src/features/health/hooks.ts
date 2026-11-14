/**
 * Data hooks for the astronaut health pages. They fetch and cache; every value,
 * status and reference comes from the backend.
 */
import { useQuery } from '@tanstack/react-query';
import { astronautsApi } from '@/api/astronauts';
import { cognitionApi } from '@/api/cognition';
import { isApiError } from '@/api/client';
import { planningApi } from '@/api/planning';
import { radiationApi } from '@/api/radiation';
import { recoveryApi } from '@/api/recovery';
import { sleepApi } from '@/api/sleep';
import { vitalsApi } from '@/api/vitals';
import { useSession } from '@/features/auth/sessionStore';
import { useMissionState } from '@/features/shell/useMissionState';

/** The signed-in astronaut and the mission clock every health query is bounded by. */
export function useAstronautContext() {
  const astronautId = useSession((s) => s.astronautId);
  const mission = useMissionState();
  const state = mission.data;
  return {
    astronautId,
    mission,
    missionTime: state?.mission_time ?? null,
    missionDate: state?.mission_time.slice(0, 10) ?? null,
    launch: state?.mission.launch_date ?? null,
  };
}

type Range = { from: string; to: string } | null;

export function useHealthSummary(astronautId: string | null) {
  return useQuery({
    queryKey: ['astronauts', astronautId, 'health-summary'],
    queryFn: () => astronautsApi.healthSummary(astronautId!),
    enabled: !!astronautId,
  });
}

export function useReadinessSummary(astronautId: string | null) {
  return useQuery({
    queryKey: ['astronauts', astronautId, 'readiness-summary'],
    queryFn: () => astronautsApi.readinessSummary(astronautId!),
    enabled: !!astronautId,
  });
}

export function useVitalsHistory(astronautId: string | null, type: string, range: Range) {
  return useQuery({
    queryKey: ['vitals', astronautId, type, range],
    queryFn: () =>
      vitalsApi.history({
        astronaut_id: astronautId!,
        measurement_type: type,
        limit: 5000,
        ...range!,
      }),
    enabled: !!astronautId && !!range,
  });
}

/** Personal reference for one measure. A 404 means "none yet" and resolves to null. */
export function useVitalsReference(astronautId: string | null, type: string) {
  return useQuery({
    queryKey: ['vitals', astronautId, type, 'reference'],
    queryFn: async () => {
      try {
        return await vitalsApi.reference({ astronaut_id: astronautId!, measurement_type: type });
      } catch (error) {
        if (isApiError(error) && error.kind === 'not_found') return null;
        throw error;
      }
    },
    enabled: !!astronautId,
  });
}

export function useRadiation(astronautId: string | null, range: Range) {
  return useQuery({
    queryKey: ['radiation', astronautId, range],
    queryFn: () => radiationApi.readings({ astronaut_id: astronautId!, ...range! }),
    enabled: !!astronautId && !!range,
  });
}

export function useSleep(astronautId: string | null, range: Range) {
  return useQuery({
    queryKey: ['sleep', astronautId, range],
    queryFn: () => sleepApi.records({ astronaut_id: astronautId!, ...range! }),
    enabled: !!astronautId && !!range,
  });
}

export function useActivity(astronautId: string | null, range: Range) {
  return useQuery({
    queryKey: ['activity', astronautId, range],
    queryFn: () => vitalsApi.activity({ astronaut_id: astronautId!, ...range! }),
    enabled: !!astronautId && !!range,
  });
}

export function useComparisons(astronautId: string | null, range: Range) {
  return useQuery({
    queryKey: ['cognition', astronautId, 'comparisons', range],
    queryFn: () => cognitionApi.comparisons({ astronaut_id: astronautId!, ...range! }),
    enabled: !!astronautId && !!range,
  });
}

export function useSchedule(astronautId: string | null, date: string | null) {
  return useQuery({
    queryKey: ['astronauts', astronautId, 'schedule', date],
    queryFn: () => astronautsApi.schedule(astronautId!, date!),
    enabled: !!astronautId && !!date,
  });
}

export function useScheduledRecovery(astronautId: string | null, range: Range) {
  return useQuery({
    queryKey: ['recovery', astronautId, 'scheduled', range],
    queryFn: () => recoveryApi.scheduled({ astronaut_id: astronautId!, ...range! }),
    enabled: !!astronautId && !!range,
  });
}

export function useRecoveryCatalogue() {
  return useQuery({
    queryKey: ['planning', 'recovery-catalogue'],
    queryFn: () => planningApi.recoveryCatalogue(),
    staleTime: 10 * 60_000,
  });
}

export function useAlerts(astronautId: string | null) {
  return useQuery({
    queryKey: ['astronauts', astronautId, 'alerts'],
    queryFn: () => astronautsApi.alerts(astronautId!),
    enabled: !!astronautId,
  });
}
