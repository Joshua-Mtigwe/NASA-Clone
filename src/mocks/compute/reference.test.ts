// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { mockState, resetMockDb, table } from '../db';
import { physiologicalReference, readinessSummary, REFERENCE_METHOD } from './reference';

beforeEach(() => resetMockDb());

describe('mock physiological reference stub', () => {
  it('is mean ± 2 SD of the first 7 mission days, and absent until enough data exists', async () => {
    mockState.missionDayOverride = 25;
    const ref = (await physiologicalReference('AST-001', 'hrv_rmssd'))!;

    const values = (await table('sensor_readings'))
      .filter(
        (r) =>
          r.astronaut_id === 'AST-001' &&
          r.measurement_type === 'hrv_rmssd' &&
          r.timestamp_utc < '2027-03-08T00:00:00',
      )
      .map((r) => r.measurement_value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1));

    expect(ref.sample_size).toBe(168);
    expect(ref.reference_method).toBe(REFERENCE_METHOD);
    expect(ref.reference_lower).toBeCloseTo(mean - 2 * sd, 1);
    expect(ref.reference_upper).toBeCloseTo(mean + 2 * sd, 1);

    mockState.missionDayOverride = 1; // 12:00 on day 1: only 13 hourly readings
    expect(await physiologicalReference('AST-001', 'hrv_rmssd')).toBeNull();
  });

  it('assigns each readiness factor a status from its reference, never a combined score', async () => {
    mockState.missionDayOverride = 25;
    const summary = await readinessSummary('AST-001');

    expect(summary.as_of).toBe('2027-03-25T12:00:00Z');
    for (const f of summary.factors) {
      if (f.reference_range_status === 'no_data') continue;
      if (f.kind !== 'cognitive') {
        const inside = f.value! >= f.reference_lower! && f.value! <= f.reference_upper!;
        expect(f.reference_range_status).toBe(inside ? 'within_reference' : 'outside_reference');
      }
    }
    expect(summary.factors.map((f) => f.factor)).toEqual(
      expect.arrayContaining(['heart_rate', 'sleep_duration', 'vigilance', 'working_memory']),
    );
    expect(Object.keys(summary)).not.toContain('score');
    expect(summary.operational?.assessment_date).toBe('2027-03-25');
  });
});
