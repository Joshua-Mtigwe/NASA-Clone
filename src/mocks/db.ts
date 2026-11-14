/**
 * In-memory mock database. Each table is loaded lazily from its CSV-derived
 * fixture and copied, so mock writes (POST/PATCH) never touch the fixture cache.
 */
import type { TableName, Tables } from '@/types/tables';
import { loadTable } from './fixtures/loader';
import { MOCK_SEEDS } from './seeds';

const tables = new Map<TableName, Promise<unknown[]>>();

export function table<K extends TableName>(name: K): Promise<Tables[K][]> {
  let pending = tables.get(name);
  if (!pending) {
    const seeds: unknown[] = (MOCK_SEEDS as Partial<Record<TableName, unknown[]>>)[name] ?? [];
    pending = loadTable(name).then((rows) => [
      ...rows.map((row) => ({ ...row })),
      ...seeds.map((row) => ({ ...(row as object) })),
    ]);
    tables.set(name, pending);
  }
  return pending as Promise<Tables[K][]>;
}

export interface MockRuntimeState {
  selectedRunId: string | null;
  revokedTokens: Set<string>;
  counters: Map<string, number>;
  /**
   * Mock-only stand-in for an advancing simulation clock. simulation_runs.csv holds
   * the run paused at launch; until the simulation controls (Phase 8) advance it,
   * VITE_MOCK_MISSION_DAY places the clock at 12:00 UTC on that mission day.
   */
  missionDayOverride: number | null;
  /** Practice trials, kept apart from assessment_trials and never scored. */
  practiceTrials: Map<string, unknown[]>;
  /** Real time (ms) when the running simulation last (re)started; null when paused. */
  runningSince: number | null;
  /** Real clock used by the simulation; tests may replace it. */
  clockNow: () => number;
}

function envMissionDay(): number | null {
  const raw = (import.meta.env as { VITE_MOCK_MISSION_DAY?: string }).VITE_MOCK_MISSION_DAY;
  const day = raw ? Number(raw) : NaN;
  return Number.isInteger(day) && day >= 1 ? day : null;
}

function initialState(): MockRuntimeState {
  return {
    selectedRunId: null,
    revokedTokens: new Set(),
    counters: new Map(),
    missionDayOverride: envMissionDay(),
    practiceTrials: new Map(),
    runningSince: null,
    clockNow: () => Date.now(),
  };
}

export let mockState: MockRuntimeState = initialState();

/** Reset all mock writes and runtime state (used between tests). */
export function resetMockDb(): void {
  tables.clear();
  mockState = initialState();
}

/** Generate an id for a row created in mock mode, for example `MOCK-SES-0001`. */
export function nextId(prefix: string): string {
  const n = (mockState.counters.get(prefix) ?? 0) + 1;
  mockState.counters.set(prefix, n);
  return `MOCK-${prefix}-${String(n).padStart(4, '0')}`;
}
