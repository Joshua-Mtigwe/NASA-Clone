/**
 * Mock stand-in for the backend assessment scheduler. Every assignment in
 * assessment_assignments.csv is already completed, so for the current mission day
 * this creates demo assignments from the mock-only templates in seeds.ts:
 *   - a preflight battery (every test, varied condition tags, one waiting for access)
 *   - the daily Mission Mind set: two rotating games plus the check-in
 * It also decides whether each session's conditions are met at the mission clock.
 */
import type { MissionMindSummary } from '@/api/types';
import type { AssessmentAssignmentsRow } from '@/types/tables';
import { mockState, nextId, table } from '../db';
import { currentMissionState } from './mission';
import { PROTOCOL_DOMAIN } from './scoring';

export const PREFLIGHT_TEMPLATE = 'TPL-MOCK-PRE-DEMO';
export const MISSION_MIND_TEMPLATE = 'TPL-MOCK-MISSION-MIND';
export const MISSION_MIND_GAMES = ['PVT', 'NBACK', 'STROOP', 'ROTATION', 'SWITCH'] as const;

/** Condition tag and access status for each demo preflight session. */
const PREFLIGHT_PLAN: Array<[protocol: string, condition: string, access: string]> = [
  ['SURVEY', 'morning', 'authorized'],
  ['PVT', 'morning', 'authorized'],
  ['NBACK', 'after_mental_work', 'authorized'],
  ['STROOP', 'before_physical_work', 'authorized'],
  ['SYMBOL', 'afternoon', 'authorized'],
  ['ROTATION', 'night', 'authorized'],
  ['SWITCH', 'after_physical_work', 'authorized'],
  ['REASONING', 'weekly_extended', 'scheduled'],
];

const seeded = new WeakMap<object, Set<string>>();

function seededKeys(): Set<string> {
  let keys = seeded.get(mockState);
  if (!keys) {
    keys = new Set();
    seeded.set(mockState, keys);
  }
  return keys;
}

function timeOfDay(hour: number): string {
  if (hour >= 5 && hour < 13) return 'morning';
  if (hour >= 13 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/** Mission Mind games scheduled on a mission day: two, rotating through all five. */
export function missionMindGamesFor(day: number): string[] {
  const n = MISSION_MIND_GAMES.length;
  return [MISSION_MIND_GAMES[(day - 1) % n]!, MISSION_MIND_GAMES[day % n]!];
}

export async function ensureDemoAssignments(astronautId: string): Promise<void> {
  const state = await currentMissionState();
  const date = state.mission_time.slice(0, 10);
  const key = `${astronautId}|${date}`;
  if (seededKeys().has(key)) return;
  seededKeys().add(key);
  if (!(await table('astronauts')).some((a) => a.astronaut_id === astronautId)) return;

  const assignments = await table('assessment_assignments');
  const make = (
    protocol: string,
    template: string,
    condition: string,
    access: string,
  ): AssessmentAssignmentsRow => ({
    assignment_id: nextId('ASG'),
    astronaut_id: astronautId,
    protocol_id: protocol,
    assigned_by_user_id: null,
    scheduled_at: `${date}T08:00:00Z`,
    assessment_condition: condition,
    access_status: access,
    access_expires_at: `${date}T23:59:00Z`,
    assignment_source: 'mock_demo_scheduler',
    schedule_template_id: template,
    simulation_run_id: state.simulation_run?.simulation_run_id ?? null,
  });

  for (const [protocol, condition, access] of PREFLIGHT_PLAN) {
    assignments.push(make(protocol, PREFLIGHT_TEMPLATE, condition, access));
  }
  const now = timeOfDay(new Date(state.mission_time).getUTCHours());
  for (const protocol of [...missionMindGamesFor(state.mission_day), 'SURVEY']) {
    assignments.push(make(protocol, MISSION_MIND_TEMPLATE, now, 'authorized'));
  }
}

const WINDOWS: Record<string, [number, number, string]> = {
  morning: [5, 13, '05:00–13:00 UTC'],
  afternoon: [12, 18, '12:00–18:00 UTC'],
  evening: [18, 22, '18:00–22:00 UTC'],
  night: [20, 5, '20:00–05:00 UTC'],
};

/** Backend decision: may this condition be assessed now? */
export async function checkConditions(
  condition: string,
  astronautId: string,
): Promise<{ met: boolean; reason: string | null }> {
  const state = await currentMissionState();
  const now = state.mission_time;
  const hour = new Date(now).getUTCHours();
  const window = WINDOWS[condition];
  if (window) {
    const [start, end, label] = window;
    const inside = start < end ? hour >= start && hour < end : hour >= start || hour < end;
    return inside ? { met: true, reason: null } : { met: false, reason: `Available ${label}.` };
  }
  const today = now.slice(0, 10);
  if (condition === 'after_physical_work') {
    const done = (await table('activity_records')).some(
      (a) =>
        a.astronaut_id === astronautId && a.end_time.slice(0, 10) === today && a.end_time <= now,
    );
    return done
      ? { met: true, reason: null }
      : { met: false, reason: 'Available after today’s exercise is recorded.' };
  }
  if (condition === 'after_mental_work') {
    const done = (await table('task_assignments')).some(
      (a) =>
        a.astronaut_id === astronautId &&
        a.planned_end.slice(0, 10) === today &&
        a.planned_end <= now,
    );
    return done
      ? { met: true, reason: null }
      : { met: false, reason: 'Available after a scheduled task is finished.' };
  }
  if (condition === 'weekly_extended') {
    return state.mission_day % 7 === 0
      ? { met: true, reason: null }
      : { met: false, reason: 'Runs on the weekly extended session day (every 7th mission day).' };
  }
  return { met: true, reason: null };
}

export async function missionMindSummary(astronautId: string): Promise<MissionMindSummary> {
  await ensureDemoAssignments(astronautId);
  const state = await currentMissionState();
  const now = state.mission_time;
  const date = now.slice(0, 10);
  const [assignments, protocols, sessions, results] = await Promise.all([
    table('assessment_assignments'),
    table('assessment_protocols'),
    table('assessment_sessions'),
    table('assessment_results'),
  ]);

  const today = assignments.filter(
    (a) =>
      a.astronaut_id === astronautId &&
      a.schedule_template_id === MISSION_MIND_TEMPLATE &&
      a.scheduled_at.slice(0, 10) === date,
  );
  const mine = sessions.filter(
    (s) =>
      s.astronaut_id === astronautId &&
      s.mission_phase === 'inflight' &&
      s.session_status === 'completed' &&
      s.completed_at <= now,
  );

  const games = MISSION_MIND_GAMES.map((protocolId) => {
    const assignment = today.find((a) => a.protocol_id === protocolId) ?? null;
    return {
      protocol_id: protocolId,
      protocol_name:
        protocols.find((p) => p.protocol_id === protocolId)?.protocol_name ?? protocolId,
      cognitive_domain: PROTOCOL_DOMAIN[protocolId] ?? 'unknown',
      scheduled_today: assignment !== null,
      completed_today: assignment?.access_status === 'completed',
      assignment_id: assignment?.assignment_id ?? null,
      sessions_completed_total: mine.filter((s) => s.protocol_id === protocolId).length,
    };
  });

  // Streak: consecutive days up to today (or yesterday, if today is not done yet)
  // with at least one completed inflight session.
  const days = new Set(mine.map((s) => s.completed_at.slice(0, 10)));
  const DAY = 86_400_000;
  let cursor = Date.parse(`${date}T00:00:00Z`);
  if (!days.has(date)) cursor -= DAY;
  let streak = 0;
  while (days.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= DAY;
  }

  const todaySessionIds = new Set(
    sessions
      .filter(
        (s) =>
          today.some((a) => a.assignment_id === s.assignment_id) &&
          s.session_status === 'completed',
      )
      .map((s) => s.session_id),
  );

  return {
    astronaut_id: astronautId,
    date,
    estimate_seconds: today.reduce(
      (sum, a) =>
        sum + (protocols.find((p) => p.protocol_id === a.protocol_id)?.duration_seconds ?? 0),
      0,
    ),
    sessions_scheduled_today: today.length,
    sessions_completed_today: today.filter((a) => a.access_status === 'completed').length,
    streak_days: streak,
    games,
    results_today: results.filter((r) => todaySessionIds.has(r.session_id)),
  };
}
