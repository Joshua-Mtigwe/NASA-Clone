/** Mock stand-in for the backend mission clock. */
import type { MissionState } from '@/api/types';
import { HttpError } from '../route';
import { mockState, table } from '../db';

const DAY_MS = 86_400_000;

export async function currentMissionState(): Promise<MissionState> {
  const [missions, runs] = await Promise.all([table('missions'), table('simulation_runs')]);
  const mission = missions[0];
  if (!mission) throw new HttpError(404, 'No mission configured.');

  const run =
    runs.find((r) => r.simulation_run_id === mockState.selectedRunId) ??
    runs.find((r) => r.mission_id === mission.mission_id) ??
    null;

  const launch = Date.parse(mission.launch_date);
  const end = Date.parse(mission.planned_end_date);
  const lengthDays = Math.round((end - launch) / DAY_MS);
  const override = mockState.missionDayOverride;
  const base =
    override !== null
      ? launch + (Math.min(override, lengthDays) - 1) * DAY_MS + DAY_MS / 2
      : Date.parse(run?.current_mission_time ?? mission.launch_date);
  // A running simulation advances by real elapsed time x speed_multiplier.
  const elapsed =
    run && run.status === 'running' && mockState.runningSince !== null
      ? (mockState.clockNow() - mockState.runningSince) * run.speed_multiplier
      : 0;
  const missionTime = new Date(Math.min(base + elapsed, end))
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  const day = Math.floor((Date.parse(missionTime) - launch) / DAY_MS) + 1;
  const dataMode = run?.data_mode ?? 'unknown';

  return {
    mission,
    simulation_run: run,
    mission_time: missionTime,
    mission_day: Math.min(Math.max(day, 1), lengthDays),
    mission_length_days: lengthDays,
    data_mode: dataMode,
    is_synthetic: dataMode.includes('synthetic'),
  };
}

export async function missionNow(): Promise<string> {
  return (await currentMissionState()).mission_time;
}

/** Mission phase for a timestamp: before launch is preflight. */
export async function missionPhaseAt(timestamp: string): Promise<string> {
  const { mission } = await currentMissionState();
  return timestamp < mission.launch_date ? 'preflight' : 'inflight';
}

export function minutesBetween(start: string, end: string | null): number | null {
  if (!end) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
}

/** Freeze the clock at its current value (on pause, speed change or run switch). */
export async function commitMissionClock(): Promise<void> {
  const state = await currentMissionState();
  if (state.simulation_run) state.simulation_run.current_mission_time = state.mission_time;
  mockState.missionDayOverride = null;
  mockState.runningSince = state.simulation_run?.status === 'running' ? mockState.clockNow() : null;
}
