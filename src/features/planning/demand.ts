import type { PlanningTask } from '@/api/types';

export const DEMAND_ITEMS = [
  { key: 'attention', label: 'Sustained attention' },
  { key: 'working_memory', label: 'Working memory' },
  { key: 'physical', label: 'Physical effort' },
  { key: 'time_pressure', label: 'Time pressure' },
  { key: 'procedural', label: 'Procedural complexity' },
] as const;

export type DemandKey = (typeof DEMAND_ITEMS)[number]['key'];

/** Scores come from task_requirements, or from the proposed fields where no column exists. */
export function demandValues(t: PlanningTask): Record<DemandKey, number | null> {
  const r = t.requirements[0];
  return {
    attention: r?.attention_demand_score ?? null,
    working_memory: t.proposed?.working_memory_demand_score ?? null,
    physical: r?.physical_demand_score ?? null,
    time_pressure: r?.time_pressure_score ?? null,
    procedural: t.proposed?.procedural_complexity_score ?? null,
  };
}

export function isLeaderReviewed(t: PlanningTask): boolean {
  return t.requirements[0]?.review_status === 'leader_reviewed';
}
