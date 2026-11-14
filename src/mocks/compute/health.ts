/** Mock stand-ins for backend health aggregation and rule-based alerts. */
import type {
  Alert,
  AstronautSchedule,
  HealthMeasure,
  HealthMeasurement,
  HealthSummary,
  ScheduleItem,
} from '@/api/types';
import { table } from '../db';
import { minutesBetween, missionNow } from './mission';
import { visibleAssignments } from './planningOps';

function latest<T>(rows: T[], time: (row: T) => string | null, asOf: string): T | undefined {
  let best: T | undefined;
  let bestTime = '';
  for (const row of rows) {
    const t = time(row);
    if (t !== null && t <= asOf && t > bestTime) {
      best = row;
      bestTime = t;
    }
  }
  return best;
}

function noData(measure: HealthMeasure): HealthMeasurement {
  return {
    measure,
    value: null,
    unit: null,
    measured_at: null,
    source_id: null,
    source_type: null,
    quality_status: null,
    provenance: null,
    source_table: null,
  };
}

const SENSOR_MEASURES: HealthMeasure[] = [
  'heart_rate',
  'hrv_rmssd',
  'spo2',
  'respiratory_rate',
  'body_temperature',
];

export async function healthSummary(astronautId: string): Promise<HealthSummary> {
  const asOf = await missionNow();
  const [sensorRows, sleep, radiation, activity] = await Promise.all([
    table('sensor_readings'),
    table('sleep_records'),
    table('radiation_readings'),
    table('activity_records'),
  ]);
  const mine = sensorRows.filter((r) => r.astronaut_id === astronautId);

  const measurements: HealthMeasurement[] = SENSOR_MEASURES.map((measure) => {
    const row = latest(
      mine.filter((r) => r.measurement_type === measure),
      (r) => r.timestamp_utc,
      asOf,
    );
    if (!row) return noData(measure);
    return {
      measure,
      value: row.measurement_value,
      unit: row.measurement_unit,
      measured_at: row.timestamp_utc,
      source_id: row.sensor_id,
      source_type: row.source_type,
      quality_status: row.quality_status,
      provenance: 'measured',
      source_table: 'sensor_readings',
    };
  });

  // No blood pressure sensor exists in sensors.csv, so this is always "No data".
  measurements.push(noData('blood_pressure'));

  const lastSleep = latest(
    sleep.filter((r) => r.astronaut_id === astronautId),
    (r) => r.sleep_end,
    asOf,
  );
  measurements.push(
    lastSleep
      ? {
          measure: 'sleep_duration',
          value: lastSleep.total_sleep_minutes,
          unit: 'min',
          measured_at: lastSleep.sleep_end,
          source_id: lastSleep.sleep_id,
          source_type: lastSleep.data_source,
          quality_status: lastSleep.quality_status,
          provenance: 'measured',
          source_table: 'sleep_records',
        }
      : noData('sleep_duration'),
  );

  const lastDose = latest(
    radiation.filter((r) => r.astronaut_id === astronautId),
    (r) => r.timestamp_utc,
    asOf,
  );
  measurements.push(
    lastDose
      ? {
          measure: 'radiation_dose_rate',
          value: lastDose.dose_rate,
          unit: lastDose.dose_rate_unit,
          measured_at: lastDose.timestamp_utc,
          source_id: lastDose.sensor_id,
          source_type: lastDose.source_type,
          quality_status: null,
          provenance: 'measured',
          source_table: 'radiation_readings',
        }
      : noData('radiation_dose_rate'),
  );

  const lastActivity = latest(
    activity.filter((r) => r.astronaut_id === astronautId),
    (r) => r.end_time,
    asOf,
  );
  measurements.push(
    lastActivity
      ? {
          measure: 'physical_activity',
          value: lastActivity.duration_minutes,
          unit: 'min',
          measured_at: lastActivity.end_time,
          source_id: lastActivity.activity_id,
          source_type: lastActivity.source_type,
          quality_status: null,
          provenance: 'measured',
          source_table: 'activity_records',
        }
      : noData('physical_activity'),
  );

  return { astronaut_id: astronautId, as_of: asOf, measurements };
}

export async function astronautSchedule(
  astronautId: string,
  date: string | undefined,
): Promise<AstronautSchedule> {
  const day = date ?? (await missionNow()).slice(0, 10);
  const onDay = (ts: string | null) => ts !== null && ts.slice(0, 10) === day;

  const [
    schedules,
    scheduledRecovery,
    recoveryActivities,
    assignments,
    tasks,
    requirements,
    activity,
    assessments,
    protocols,
    sleep,
  ] = await Promise.all([
    table('daily_schedules'),
    table('scheduled_recovery'),
    table('recovery_activities'),
    table('task_assignments'),
    table('mission_tasks'),
    table('task_requirements'),
    table('activity_records'),
    table('assessment_assignments'),
    table('assessment_protocols'),
    table('sleep_records'),
  ]);

  const items: ScheduleItem[] = [];

  for (const s of schedules) {
    if (s.astronaut_id !== astronautId || !onDay(s.start_time)) continue;
    const scheduled =
      scheduledRecovery.find((r) => r.scheduled_recovery_id === s.activity_reference_id) ??
      scheduledRecovery.find((r) => r.schedule_id === s.schedule_id);
    const activityRow = recoveryActivities.find(
      (a) => a.recovery_activity_id === scheduled?.recovery_activity_id,
    );
    items.push({
      kind: 'recovery',
      ref_id: s.schedule_id,
      title: activityRow?.activity_name ?? s.activity_type,
      start_time: s.start_time,
      end_time: s.end_time,
      duration_minutes: minutesBetween(s.start_time, s.end_time),
      priority: null,
      workload_category: activityRow?.activity_category ?? null,
      completion_status: scheduled?.completion_status ?? s.schedule_status,
      approval_status: s.approval_status,
    });
  }

  // Only the version the crew should see: the approved one for the day, else the preloaded draft.
  const visible = new Set((await visibleAssignments(day)).map((a) => a.task_assignment_id));
  for (const a of assignments) {
    if (!visible.has(a.task_assignment_id)) continue;
    if (a.astronaut_id !== astronautId || !onDay(a.planned_start)) continue;
    const task = tasks.find((t) => t.task_id === a.task_id);
    const req = requirements.find((r) => r.task_id === a.task_id);
    items.push({
      kind: 'task',
      ref_id: a.task_assignment_id,
      title: task?.task_title ?? a.task_id,
      start_time: a.planned_start,
      end_time: a.planned_end,
      duration_minutes:
        task?.estimated_duration_minutes ?? minutesBetween(a.planned_start, a.planned_end),
      priority: task?.priority ?? null,
      workload_category: task?.task_category ?? (req ? 'task' : null),
      completion_status: a.assignment_status,
      approval_status: a.approval_status,
    });
  }

  for (const r of activity) {
    if (r.astronaut_id !== astronautId || !onDay(r.start_time)) continue;
    items.push({
      kind: 'exercise',
      ref_id: r.activity_id,
      title: r.activity_type,
      start_time: r.start_time,
      end_time: r.end_time,
      duration_minutes: r.duration_minutes,
      priority: null,
      workload_category: r.physical_intensity,
      completion_status: null,
      approval_status: null,
    });
  }

  for (const a of assessments) {
    if (a.astronaut_id !== astronautId || !onDay(a.scheduled_at)) continue;
    const protocol = protocols.find((p) => p.protocol_id === a.protocol_id);
    items.push({
      kind: 'assessment',
      ref_id: a.assignment_id,
      title: protocol?.protocol_name ?? a.protocol_id,
      start_time: a.scheduled_at,
      end_time: null,
      duration_minutes: protocol ? Math.round(protocol.duration_seconds / 60) : null,
      priority: null,
      workload_category: a.assessment_condition,
      completion_status: a.access_status,
      approval_status: null,
    });
  }

  for (const s of sleep) {
    if (s.astronaut_id !== astronautId || !onDay(s.sleep_start)) continue;
    items.push({
      kind: 'sleep',
      ref_id: s.sleep_id,
      title: 'Sleep',
      start_time: s.sleep_start,
      end_time: s.sleep_end,
      duration_minutes: minutesBetween(s.sleep_start, s.sleep_end),
      priority: null,
      workload_category: null,
      completion_status: null,
      approval_status: null,
    });
  }

  items.sort((a, b) => a.start_time.localeCompare(b.start_time));
  return { astronaut_id: astronautId, date: day, items };
}

/** Rule: a daily comparison outside the personal reference is flagged for contextual review. */
export async function astronautAlerts(astronautId: string): Promise<Alert[]> {
  const asOf = await missionNow();
  const [comparisons, daily] = await Promise.all([
    table('cognitive_comparisons'),
    table('daily_cognitive_results'),
  ]);
  return comparisons
    .filter(
      (c) =>
        c.astronaut_id === astronautId &&
        c.reference_range_status === 'outside_reference' &&
        c.calculated_at <= asOf,
    )
    .map((c) => {
      const result = daily.find((d) => d.daily_result_id === c.daily_result_id);
      const domain = result?.cognitive_domain ?? 'cognitive';
      return {
        alert_id: `ALR-${c.comparison_id}`,
        astronaut_id: astronautId,
        rule_id: 'RULE-COG-OUTSIDE-REFERENCE',
        severity: 'review' as const,
        title: `${domain.replace(/_/g, ' ')} result flagged for contextual review`,
        detail: `Day ${result?.mission_day ?? '?'} result is outside the personal preflight reference (${c.comparison_method}).`,
        source_table: 'cognitive_comparisons',
        source_id: c.comparison_id,
        triggered_at: c.calculated_at,
        sync_state: 'synced' as const,
      };
    })
    .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at));
}
