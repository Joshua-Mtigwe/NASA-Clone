/**
 * Mock stand-ins for the backend's personal physiological reference and daily
 * readiness summary. The CSVs hold no preflight vitals, so the stub reference uses
 * the first 7 mission days observed so far: mean ± 2 SD, the same rule
 * cognitive_baselines.csv follows (e.g. 289.0 ± 2 × 7.28 = 274.43 to 303.57).
 */
import type {
  PhysiologicalReference,
  ReadinessFactor,
  ReadinessSummary,
  ReferenceRangeStatus,
} from '@/api/types';
import { table } from '../db';
import { currentMissionState } from './mission';
import { median } from './scoring';

export const REFERENCE_METHOD = 'mock_stub_first_7_mission_days_mean_2sd';
const REFERENCE_WINDOW_MS = 7 * 86_400_000;
const MIN_SAMPLES = 24;

export const SENSOR_MEASURES = [
  'heart_rate',
  'hrv_rmssd',
  'spo2',
  'respiratory_rate',
  'body_temperature',
] as const;

interface Observation {
  timestamp: string;
  value: number;
  unit: string;
}

async function observations(astronautId: string, measurement: string): Promise<Observation[]> {
  if (measurement === 'radiation_dose_rate') {
    return (await table('radiation_readings'))
      .filter((r) => r.astronaut_id === astronautId)
      .map((r) => ({ timestamp: r.timestamp_utc, value: r.dose_rate, unit: r.dose_rate_unit }));
  }
  if (measurement === 'sleep_duration') {
    return (await table('sleep_records'))
      .filter((r) => r.astronaut_id === astronautId)
      .map((r) => ({ timestamp: r.sleep_end, value: r.total_sleep_minutes, unit: 'min' }));
  }
  return (await table('sensor_readings'))
    .filter((r) => r.astronaut_id === astronautId && r.measurement_type === measurement)
    .map((r) => ({
      timestamp: r.timestamp_utc,
      value: r.measurement_value,
      unit: r.measurement_unit,
    }));
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export async function physiologicalReference(
  astronautId: string,
  measurement: string,
): Promise<PhysiologicalReference | null> {
  const { mission, mission_time: now } = await currentMissionState();
  const windowEnd = new Date(Date.parse(mission.launch_date) + REFERENCE_WINDOW_MS).toISOString();
  const sample = (await observations(astronautId, measurement)).filter(
    (o) => o.timestamp >= mission.launch_date && o.timestamp < windowEnd && o.timestamp <= now,
  );
  // Sleep and personal dosimetry are daily, so their windows hold far fewer samples.
  const minimum =
    measurement === 'sleep_duration' ? 3 : measurement === 'radiation_dose_rate' ? 5 : MIN_SAMPLES;
  if (sample.length < minimum) return null;

  const values = sample.map((o) => o.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));
  return {
    astronaut_id: astronautId,
    measurement_type: measurement,
    metric_unit: sample[0]!.unit,
    median_value: round(median(values)!),
    mean_value: round(mean),
    standard_deviation: round(sd),
    reference_lower: round(mean - 2 * sd),
    reference_upper: round(mean + 2 * sd),
    sample_size: values.length,
    reference_method: REFERENCE_METHOD,
    baseline_version: 'mock_v1',
    calculated_at: sample[sample.length - 1]!.timestamp,
  };
}

function status(value: number | null, ref: PhysiologicalReference | null): ReferenceRangeStatus {
  if (value === null || !ref) return 'no_data';
  return value >= ref.reference_lower && value <= ref.reference_upper
    ? 'within_reference'
    : 'outside_reference';
}

function latestUpTo(rows: Observation[], now: string): Observation | null {
  let best: Observation | null = null;
  for (const o of rows) if (o.timestamp <= now && (!best || o.timestamp > best.timestamp)) best = o;
  return best;
}

export async function readinessSummary(astronautId: string): Promise<ReadinessSummary> {
  const { mission_time: now } = await currentMissionState();
  const factors: ReadinessFactor[] = [];

  for (const measure of [...SENSOR_MEASURES, 'radiation_dose_rate', 'sleep_duration'] as const) {
    const latest = latestUpTo(await observations(astronautId, measure), now);
    const ref = await physiologicalReference(astronautId, measure);
    factors.push({
      factor: measure,
      kind: measure === 'sleep_duration' ? 'sleep' : 'physiological',
      value: latest?.value ?? null,
      unit: latest?.unit ?? null,
      measured_at: latest?.timestamp ?? null,
      reference_lower: ref?.reference_lower ?? null,
      reference_upper: ref?.reference_upper ?? null,
      reference_range_status: status(latest?.value ?? null, ref),
      source_table:
        measure === 'sleep_duration'
          ? 'sleep_records'
          : measure === 'radiation_dose_rate'
            ? 'radiation_readings'
            : 'sensor_readings',
    });
  }

  // Cognitive factors: the latest comparison per domain, status as stored in the CSV.
  const [comparisons, daily, baselines, readiness] = await Promise.all([
    table('cognitive_comparisons'),
    table('daily_cognitive_results'),
    table('cognitive_baselines'),
    table('crew_readiness'),
  ]);
  const dailyById = new Map(daily.map((d) => [d.daily_result_id, d]));
  const latestByDomain = new Map<string, (typeof comparisons)[number]>();
  for (const c of comparisons) {
    if (c.astronaut_id !== astronautId || c.calculated_at > now) continue;
    const domain = dailyById.get(c.daily_result_id)?.cognitive_domain;
    if (!domain || domain === 'subjective_fatigue') continue;
    const prev = latestByDomain.get(domain);
    if (!prev || c.calculated_at > prev.calculated_at) latestByDomain.set(domain, c);
  }
  for (const [domain, c] of latestByDomain) {
    const result = dailyById.get(c.daily_result_id);
    const baseline = baselines.find((b) => b.baseline_id === c.baseline_id);
    factors.push({
      factor: domain,
      kind: 'cognitive',
      value: c.inflight_value,
      unit: result?.metric_unit ?? null,
      measured_at: c.calculated_at,
      reference_lower: baseline?.reference_lower ?? null,
      reference_upper: baseline?.reference_upper ?? null,
      reference_range_status:
        c.reference_range_status === 'within_reference' ? 'within_reference' : 'outside_reference',
      source_table: 'cognitive_comparisons',
    });
  }

  const operational =
    readiness
      .filter((r) => r.astronaut_id === astronautId && r.assessment_date <= now.slice(0, 10))
      .sort((a, b) => b.assessment_date.localeCompare(a.assessment_date))[0] ?? null;

  return { astronaut_id: astronautId, as_of: now, operational, factors };
}
