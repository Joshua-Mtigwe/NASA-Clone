/**
 * Mock stand-in for the backend's supportive-routine publication. The Mission
 * Planning Leader publishes a recommendation directly (no medical-review step). The
 * draft rows the CSVs already hold for that recommendation (daily_schedules +
 * scheduled_recovery) are promoted rather than duplicated, so publishing twice
 * never creates a second schedule entry.
 */
import type {
  PublishedRoutine,
  RoutineConflict,
  RoutinePublication,
  SessionUser,
} from '@/api/types';
import type { DailySchedulesRow, ScheduledRecoveryRow } from '@/types/tables';
import { mockState, nextId, table } from '../db';
import { persistRow } from '../persist';
import { HttpError, notFound } from '../route';
import { astronautSchedule } from './health';
import { currentMissionState } from './mission';

const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const PUBLISHED = 'published';

const isPublished = (row: DailySchedulesRow | undefined) =>
  row?.schedule_status === PUBLISHED && row.approval_status === 'approved';

/** Date (YYYY-MM-DD) of a mission day. */
export function missionDayDate(launch: string, day: number): string {
  return iso(Date.parse(`${launch.slice(0, 10)}T00:00:00Z`) + (day - 1) * DAY).slice(0, 10);
}

async function rowsFor(recommendationId: string) {
  const [recs, activities, schedules, scheduled] = await Promise.all([
    table('recovery_recommendations'),
    table('recovery_activities'),
    table('daily_schedules'),
    table('scheduled_recovery'),
  ]);
  const recommendation = recs.find((r) => r.recommendation_id === recommendationId);
  if (!recommendation) throw notFound('Recovery recommendation');
  const activity = activities.find(
    (a) => a.recovery_activity_id === recommendation.recovery_activity_id,
  );
  if (!activity) throw notFound('Recovery activity');
  const schedule = schedules.find(
    (s) => s.activity_type === 'recovery' && s.activity_reference_id === recommendationId,
  );
  const sched =
    (schedule && scheduled.find((r) => r.schedule_id === schedule.schedule_id)) ?? undefined;
  return { recommendation, activity, schedules, scheduled, schedule, sched };
}

export async function publishRoutine(
  recommendationId: string,
  body: { scheduled_start?: string; dry_run?: boolean },
  user: SessionUser,
): Promise<RoutinePublication> {
  const { recommendation, activity, schedules, scheduled, schedule, sched } =
    await rowsFor(recommendationId);
  const state = await currentMissionState();
  const now = state.mission_time;
  const duration = activity.recommended_duration_minutes;

  if (isPublished(schedule)) {
    // Already published: report the stored slot and change nothing.
    return {
      recommendation,
      activity,
      state: 'published',
      scheduled_start: schedule!.start_time,
      scheduled_end: schedule!.end_time,
      duration_minutes: duration,
      conflicts: [],
      reasons: [],
      schedule_id: schedule!.schedule_id,
      scheduled_recovery_id: sched?.scheduled_recovery_id ?? null,
      already_published: true,
    };
  }

  const startRaw = body.scheduled_start ?? schedule?.start_time;
  const startMs = startRaw ? Date.parse(startRaw) : NaN;
  if (!Number.isFinite(startMs)) {
    throw new HttpError(422, [
      {
        loc: ['body', 'scheduled_start'],
        msg: 'A valid ISO start time is required',
        type: 'value_error',
      },
    ]);
  }
  const start = iso(startMs);
  const end = iso(startMs + duration * MIN);
  const date = missionDayDate(state.mission.launch_date, recommendation.mission_day);
  const reasons: string[] = [];

  const astronauts = await table('astronauts');
  if (!astronauts.some((a) => a.astronaut_id === recommendation.astronaut_id)) {
    reasons.push('The astronaut on this recommendation is not on the crew list.');
  }
  if (recommendation.mission_day < state.mission_day) {
    reasons.push(`Mission day ${recommendation.mission_day} has already passed.`);
  }
  if (start.slice(0, 10) !== date || end.slice(0, 10) !== date) {
    reasons.push(
      `The routine must start and end on mission day ${recommendation.mission_day} (${date}).`,
    );
  }
  if (start < now) reasons.push('The proposed start time is before the current mission time.');
  if (activity.approval_status !== 'approved') {
    reasons.push('This routine is not approved for use on the mission.');
  }
  if (recommendation.constraint_status !== 'passed') {
    reasons.push(
      `The recommendation did not pass its constraint check (${recommendation.constraint_status}).`,
    );
  }
  // Explicit clinical restrictions are never bypassed.
  const readiness = (await table('crew_readiness'))
    .filter((r) => r.astronaut_id === recommendation.astronaut_id && r.assessment_date <= date)
    .sort((a, b) => b.assessment_date.localeCompare(a.assessment_date))[0];
  const codes = (readiness?.restriction_codes ?? 'none').trim();
  if (codes && codes !== 'none') {
    reasons.push(
      `A medical restriction is recorded for this astronaut (${codes}); it must be cleared first.`,
    );
  }

  // Availability: anything committed in the slot. Unpublished routine drafts do not block.
  const day = await astronautSchedule(recommendation.astronaut_id, date);
  const conflicts: RoutineConflict[] = day.items
    .filter((i) => !(i.kind === 'recovery' && i.approval_status !== 'approved'))
    .filter((i) => i.ref_id !== schedule?.schedule_id)
    .filter((i) => {
      const s = Date.parse(i.start_time);
      const e = i.end_time ? Date.parse(i.end_time) : s + (i.duration_minutes ?? 15) * MIN;
      return s < startMs + duration * MIN && e > startMs;
    })
    .map((i) => ({ kind: i.kind, title: i.title, start_time: i.start_time, end_time: i.end_time }));
  if (conflicts.length) reasons.push("The proposed time overlaps the astronaut's schedule.");

  const result: RoutinePublication = {
    recommendation,
    activity,
    state: reasons.length ? 'unable_to_schedule' : 'ready_to_publish',
    scheduled_start: start,
    scheduled_end: end,
    duration_minutes: duration,
    conflicts,
    reasons,
    schedule_id: schedule?.schedule_id ?? null,
    scheduled_recovery_id: sched?.scheduled_recovery_id ?? null,
    already_published: false,
  };
  if (body.dry_run) return result;
  if (reasons.length) {
    throw new HttpError(409, `Cannot publish: ${reasons.join(' ')}`);
  }

  // Promote the existing draft rows, or create them when none exist.
  let scheduleRow = schedule;
  if (!scheduleRow) {
    scheduleRow = {
      schedule_id: nextId('SCH'),
      astronaut_id: recommendation.astronaut_id,
      mission_id: state.mission.mission_id,
      schedule_date: date,
      activity_type: 'recovery',
      activity_reference_id: recommendation.recommendation_id,
      start_time: start,
      end_time: end,
      schedule_status: PUBLISHED,
      approved_by_user_id: user.user_id,
      schedule_version_id: 'SV-RECOVERY-PUBLISHED',
      simulation_run_id: state.simulation_run?.simulation_run_id ?? mockState.selectedRunId ?? '',
      approval_status: 'approved',
    };
    schedules.push(scheduleRow);
  }
  Object.assign(scheduleRow, {
    start_time: start,
    end_time: end,
    schedule_status: PUBLISHED,
    approval_status: 'approved',
    approved_by_user_id: user.user_id,
  });

  let scheduledRow: ScheduledRecoveryRow | undefined = sched;
  if (!scheduledRow) {
    scheduledRow = {
      scheduled_recovery_id: nextId('SRC'),
      astronaut_id: recommendation.astronaut_id,
      mission_id: state.mission.mission_id,
      recovery_activity_id: activity.recovery_activity_id,
      schedule_id: scheduleRow.schedule_id,
      scheduled_start: start,
      scheduled_end: end,
      completion_status: 'planned',
      completed_at: null,
      astronaut_feedback: null,
    };
    scheduled.push(scheduledRow);
  }
  Object.assign(scheduledRow, { scheduled_start: start, scheduled_end: end });
  // The recommendation keeps its link to the schedule entry it produced.
  recommendation.approval_status = PUBLISHED;

  persistRow('daily_schedules', scheduleRow);
  persistRow('scheduled_recovery', scheduledRow);
  persistRow('recovery_recommendations', recommendation);
  (await table('audit_logs')).push({
    audit_id: nextId('AUD'),
    user_id: user.user_id,
    action_type: 'publish_supportive_routine',
    entity_type: 'daily_schedules',
    entity_id: scheduleRow.schedule_id,
    action_timestamp: now,
    action_result: 'success',
    change_summary: `${activity.activity_name} for ${recommendation.astronaut_id} ${start}–${end} (from ${recommendation.recommendation_id})`,
  });

  return {
    ...result,
    state: 'published',
    schedule_id: scheduleRow.schedule_id,
    scheduled_recovery_id: scheduledRow.scheduled_recovery_id,
  };
}

/** Published routines for one astronaut and date, in time order. */
export async function publishedRoutines(
  astronautId: string,
  date: string,
): Promise<PublishedRoutine[]> {
  const [schedules, scheduled, activities] = await Promise.all([
    table('daily_schedules'),
    table('scheduled_recovery'),
    table('recovery_activities'),
  ]);
  return schedules
    .filter(
      (s) =>
        s.astronaut_id === astronautId &&
        s.activity_type === 'recovery' &&
        s.start_time.slice(0, 10) === date &&
        isPublished(s),
    )
    .map((s) => {
      const sr = scheduled.find((r) => r.schedule_id === s.schedule_id);
      return {
        schedule_id: s.schedule_id,
        scheduled_recovery_id: sr?.scheduled_recovery_id ?? null,
        recommendation_id: s.activity_reference_id,
        astronaut_id: s.astronaut_id,
        scheduled_start: s.start_time,
        scheduled_end: s.end_time,
        completion_status: sr?.completion_status ?? 'planned',
        activity:
          activities.find((a) => a.recovery_activity_id === sr?.recovery_activity_id) ?? null,
        published_by_user_id: s.approved_by_user_id,
      };
    })
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
}
