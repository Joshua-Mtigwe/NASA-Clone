import { describe, expect, it } from 'vitest';
import type { ReadinessFactor, ReadinessSummary } from '@/api/types';
import type { SleepRecordsRow } from '@/types/tables';
import { buildInsights } from './insights';
import { RING_CIRCUMFERENCE, ringOffset } from './ReadinessRing';
import { bandContribution, computeTaskReadiness, referenceContribution } from './score';

const NOW = '2027-03-25T12:00:00Z';

function factor(
  key: string,
  value: number | null,
  lower: number | null,
  upper: number | null,
  kind: ReadinessFactor['kind'] = 'physiological',
  at = '2027-03-25T11:00:00Z',
): ReadinessFactor {
  return {
    factor: key,
    kind,
    value,
    unit: null,
    measured_at: value === null ? null : at,
    reference_lower: lower,
    reference_upper: upper,
    reference_range_status:
      value === null || lower === null || upper === null
        ? 'no_data'
        : value >= lower && value <= upper
          ? 'within_reference'
          : 'outside_reference',
    source_table: null,
  };
}

const night: SleepRecordsRow = {
  sleep_id: 'S1',
  astronaut_id: 'AST-001',
  mission_id: 'MIS-001',
  sleep_start: '2027-03-24T22:30:00Z',
  sleep_end: '2027-03-25T06:30:00Z',
  total_sleep_minutes: 450,
  sleep_efficiency_percent: 90,
  awakenings_count: 1,
  sleep_quality_score: 8,
  data_source: 'wearable',
  quality_status: 'valid',
};

function input(factors: ReadinessFactor[], sleep: SleepRecordsRow[] = [night]) {
  const summary: ReadinessSummary = {
    astronaut_id: 'AST-001',
    as_of: NOW,
    operational: null,
    factors,
  };
  return { asOf: NOW, summary, health: null, sleep, comparisons: [] };
}

const allWithin = [
  factor('sleep_duration', 450, 400, 500, 'sleep', night.sleep_end),
  factor('heart_rate', 60, 55, 70),
  factor('hrv_rmssd', 50, 40, 60),
  factor('spo2', 98, 96, 99),
  factor('respiratory_rate', 14, 12, 16),
  factor('body_temperature', 36.6, 36.2, 37),
  factor('radiation_dose_rate', 0.19, 0.18, 0.2),
  factor('vigilance', 290, 270, 310, 'cognitive'),
];

describe('Task Readiness scoring', () => {
  it('scores 100 when every factor is within its personal reference, deterministically', () => {
    const a = computeTaskReadiness(input(allWithin));
    expect(a).toMatchObject({ status: 'estimated', score: 100, confidence: 'high' });
    expect(computeTaskReadiness(input(allWithin))).toEqual(a);
    expect(buildInsights(a).map((i) => i.id)).toContain('overall-consistent');
  });

  it('penalises only the unfavourable side of a reference range', () => {
    expect(referenceContribution(65, 40, 60, 'higher_is_better', 0.75)).toMatchObject({
      contribution: 1,
      deviation: 'favourable',
    });
    const low = referenceContribution(30, 40, 60, 'higher_is_better', 0.75);
    expect(low.deviation).toBe('unfavourable');
    expect(low.contribution).toBeCloseTo(0.375);
    expect(referenceContribution(10, 40, 60, 'higher_is_better', 0.75).contribution).toBe(0);
    expect(bandContribution(75, { good: 85, poor: 65 })).toBeCloseTo(0.5);
    expect(bandContribution(2, { good: 1, poor: 6 })).toBeCloseTo(0.8);
  });

  it('lowers the score and explains why when sleep is short and a vital is outside its range', () => {
    const r = computeTaskReadiness(
      input([
        factor('sleep_duration', 300, 400, 500, 'sleep', night.sleep_end),
        allWithin[1]!,
        factor('hrv_rmssd', 30, 40, 60),
        ...allWithin.slice(3),
      ]),
    );
    expect(r.score!).toBeLessThan(100);
    const ids = buildInsights(r).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['sleep-duration-below', 'vitals-outside']));
    expect(ids).not.toContain('overall-consistent');
  });

  it('never treats missing or stale data as healthy, and gives no percentage without enough data', () => {
    const stale = computeTaskReadiness(
      input([factor('heart_rate', 60, 55, 70, 'physiological', '2027-03-20T00:00:00Z')], []),
    );
    expect(stale.factors.find((f) => f.key === 'heart_rate')!.state).toBe('stale');
    expect(stale).toMatchObject({ status: 'insufficient_data', score: null });
    expect(buildInsights(stale).map((i) => i.id)).toEqual(
      expect.arrayContaining(['insufficient', 'sleep-unavailable', 'vitals-stale']),
    );

    const partial = computeTaskReadiness(input([allWithin[0]!, allWithin[1]!, allWithin[7]!]));
    expect(partial.coverage).toBeLessThan(1);
    expect(buildInsights(partial).map((i) => i.id)).toContain('uncertainty');
  });

  it('ignores anything after the mission clock and invalid-quality sleep', () => {
    const future = factor('heart_rate', 200, 55, 70, 'physiological', '2027-03-26T00:00:00Z');
    const r = computeTaskReadiness(input([future, ...allWithin.slice(2)]));
    expect(r.factors.find((f) => f.key === 'heart_rate')!.state).toBe('missing');

    const bad = computeTaskReadiness(input(allWithin, [{ ...night, quality_status: 'invalid' }]));
    expect(bad.factors.find((f) => f.key === 'sleep_efficiency')!.state).toBe('invalid');
    expect(buildInsights(bad).map((i) => i.id)).toContain('sleep-invalid');
  });
});

describe('readiness ring', () => {
  it('fills an exact share of the circumference, starting at the top', () => {
    expect(ringOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE);
    expect(ringOffset(50)).toBeCloseTo(RING_CIRCUMFERENCE / 2);
    expect(ringOffset(75)).toBeCloseTo(RING_CIRCUMFERENCE / 4);
    expect(ringOffset(100)).toBe(0);
    expect(ringOffset(140)).toBe(0);
  });
});
