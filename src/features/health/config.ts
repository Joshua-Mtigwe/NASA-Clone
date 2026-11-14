import type { HealthMeasure } from '@/api/types';

export interface MeasureMeta {
  label: string;
  fractionDigits: number;
}

/** Card order and labels for the Overview (BUILD_PLAN Phase 2, item 1). */
export const MEASURES: Record<HealthMeasure, MeasureMeta> = {
  heart_rate: { label: 'Heart rate', fractionDigits: 0 },
  hrv_rmssd: { label: 'Heart rate variability (RMSSD)', fractionDigits: 0 },
  spo2: { label: 'Blood oxygen (SpO2)', fractionDigits: 1 },
  blood_pressure: { label: 'Blood pressure', fractionDigits: 0 },
  respiratory_rate: { label: 'Respiratory rate', fractionDigits: 1 },
  body_temperature: { label: 'Body temperature', fractionDigits: 1 },
  sleep_duration: { label: 'Sleep duration', fractionDigits: 0 },
  radiation_dose_rate: { label: 'Radiation dose rate', fractionDigits: 3 },
  physical_activity: { label: 'Physical activity', fractionDigits: 0 },
};

export const MEASURE_ORDER: HealthMeasure[] = [
  'heart_rate',
  'hrv_rmssd',
  'spo2',
  'blood_pressure',
  'respiratory_rate',
  'body_temperature',
  'sleep_duration',
  'radiation_dose_rate',
  'physical_activity',
];

/** sensor_readings.measurement_type values charted on Health Monitoring. */
export const SENSOR_SERIES = [
  'heart_rate',
  'hrv_rmssd',
  'spo2',
  'respiratory_rate',
  'body_temperature',
] as const;
export type SensorSeries = (typeof SENSOR_SERIES)[number];

/** Six domains for the cognitive snapshot. Keys are cognitive_domain values. */
export const COGNITIVE_DOMAINS = [
  { key: 'vigilance', label: 'Reaction time' },
  { key: 'attention', label: 'Attention' },
  { key: 'working_memory', label: 'Working memory' },
  { key: 'processing_speed', label: 'Processing speed' },
  { key: 'reasoning', label: 'Reasoning' },
  { key: 'cognitive_flexibility', label: 'Cognitive flexibility' },
] as const;

export function factorLabel(factor: string): string {
  if (factor in MEASURES) return MEASURES[factor as HealthMeasure].label;
  const domain = COGNITIVE_DOMAINS.find((d) => d.key === factor);
  if (domain) return domain.key === 'vigilance' ? 'Reaction time (vigilance)' : domain.label;
  return factor.replace(/_/g, ' ');
}

export type TimeRange = '24h' | '7d' | '30d' | 'mission';

export const TIME_RANGES: Array<{ key: TimeRange; label: string }> = [
  { key: '24h', label: '24 h' },
  { key: '7d', label: '7 d' },
  { key: '30d', label: '30 d' },
  { key: 'mission', label: 'Mission' },
];

const HOUR = 3_600_000;
const SPAN: Record<Exclude<TimeRange, 'mission'>, number> = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
};

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** Query window ending at the mission clock. Never requests data after "now". */
export function rangeBounds(
  range: TimeRange,
  missionTime: string,
  launch: string,
): { from: string; to: string } {
  const to = Date.parse(missionTime);
  const from = range === 'mission' ? Date.parse(launch) : to - SPAN[range];
  return { from: iso(from), to: iso(to) };
}

/** YYYY-MM-DD shifted by whole days. */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
}
