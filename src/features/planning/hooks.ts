import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { astronautsApi } from '@/api/astronauts';
import { planningApi } from '@/api/planning';
import { queryKeys } from '@/app/queryClient';
import { shiftDate } from '@/features/health/config';
import { useMissionState } from '@/features/shell/useMissionState';

/** Day picker state for planning pages: starts on the current mission day. */
export function usePlanningDay() {
  const mission = useMissionState();
  const [offset, setOffset] = useState(0);
  const today = mission.data?.mission_time.slice(0, 10) ?? null;
  return {
    date: today ? shiftDate(today, offset) : null,
    offset,
    prev: () => setOffset((o) => o - 1),
    next: () => setOffset((o) => o + 1),
  };
}

export function usePlannerOverview(date: string | null) {
  return useQuery({
    queryKey: ['planning', 'overview', date],
    queryFn: () => planningApi.overview(date!),
    enabled: !!date,
  });
}

export function useCrewOverview() {
  return useQuery({
    queryKey: ['planning', 'crew-overview'],
    queryFn: () => planningApi.crewOverview(),
  });
}

export function useTaskSet(taskSetId: string | null) {
  return useQuery({
    queryKey: ['planning', 'task-set', taskSetId],
    queryFn: () => planningApi.getTaskSet(taskSetId!),
    enabled: !!taskSetId,
  });
}

export function useScheduleVersions(taskSetId: string | null) {
  return useQuery({
    queryKey: ['planning', 'schedules', taskSetId],
    queryFn: () => planningApi.listSchedules({ task_set_id: taskSetId! }),
    enabled: !!taskSetId,
  });
}

export function useSchedule(versionId: string | null) {
  return useQuery({
    queryKey: ['planning', 'schedule', versionId],
    queryFn: () => planningApi.getSchedule(versionId!),
    enabled: !!versionId,
  });
}

export function useCrew() {
  return useQuery({ queryKey: queryKeys.astronauts, queryFn: () => astronautsApi.list() });
}

/** Each astronaut's day, used for the locked blocks (sleep, exercise, assessments, routines). */
export function useCrewDays(ids: string[], date: string | null) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['astronauts', id, 'schedule', date],
      queryFn: () => astronautsApi.schedule(id, date!),
      enabled: !!date,
    })),
  });
}
