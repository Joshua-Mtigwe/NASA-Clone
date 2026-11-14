// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createManualClock } from '@/test/manualClock';
import { NBACK, PVT } from '../battery/core';
import { buildSchedule } from '../battery/registry';
import { createTrialEngine } from './engine';
import type { TrialSpec } from './types';

const BASE = '2027-03-25T12:00:00Z';
const spec = (foreperiodMs: number, patch: Partial<TrialSpec> = {}): TrialSpec => ({
  stimulus_type: 'visual_signal',
  stimulus_value: 'target',
  expected_response: 'click',
  foreperiodMs,
  stimulusMs: null,
  responseWindowMs: 10_000,
  display: {},
  ...patch,
});

function pvtEngine(specs: TrialSpec[]) {
  const m = createManualClock();
  const onFinish = vi.fn();
  const engine = createTrialEngine({
    definition: PVT,
    phase: 'test',
    specs,
    baseTimestamp: BASE,
    clock: m.clock,
    timers: m.timers,
    onFinish,
  });
  engine.start();
  return { engine, m, onFinish };
}

describe('trial engine', () => {
  it('randomises PVT foreperiods within 2–10 s and reproduces them from the same seed', () => {
    const a = buildSchedule(PVT, 'ASG-1|SES-1', 'test');
    const b = buildSchedule(PVT, 'ASG-1|SES-1', 'test');
    const c = buildSchedule(PVT, 'ASG-1|SES-2', 'test');
    const fps = a.map((s) => s.foreperiodMs);
    expect(a).toHaveLength(20);
    expect(fps.every((f) => f >= 2000 && f <= 10_000)).toBe(true);
    expect(new Set(fps).size).toBeGreaterThan(5);
    expect(b.map((s) => s.foreperiodMs)).toEqual(fps);
    expect(c.map((s) => s.foreperiodMs)).not.toEqual(fps);
    expect(buildSchedule(PVT, 'ASG-1|SES-1', 'practice').map((s) => s.foreperiodMs)).not.toEqual(
      fps.slice(0, 3),
    );
  });

  it('shows the stimulus exactly at the foreperiod and measures RT from onset with the clock', () => {
    const { engine, m } = pvtEngine([spec(3000)]);
    m.advance(2999);
    expect(engine.getState()).toMatchObject({ status: 'foreperiod', stimulusVisible: false });
    m.advance(1);
    expect(engine.getState()).toMatchObject({ status: 'stimulus', stimulusVisible: true });
    m.advance(312.4);
    engine.respond('click', 'keyboard');

    expect(engine.getRecords()[0]).toMatchObject({
      trial_number: 1,
      reaction_time_ms: 312.4,
      actual_response: 'click',
      is_correct: 1,
      is_lapse: 0,
      is_false_start: 0,
      input_device: 'keyboard',
      test_version: 'pvt-v1',
      phase: 'test',
      trial_timestamp: '2027-03-25T12:00:03Z',
    });
  });

  it('records a response before onset as a false start with a negative RT, then moves on', () => {
    const { engine, m } = pvtEngine([spec(4000), spec(2000)]);
    m.advance(3800);
    engine.respond('click', 'touch');

    const [first] = engine.getRecords();
    expect(first).toMatchObject({
      is_false_start: 1,
      is_correct: 0,
      is_lapse: 0,
      reaction_time_ms: -200,
      input_device: 'touch',
    });
    expect(engine.getState()).toMatchObject({ status: 'foreperiod', index: 1 });
  });

  it('flags slow responses (>= 500 ms) and missed signals as lapses', () => {
    const { engine, m, onFinish } = pvtEngine([spec(2000), spec(2000)]);
    m.advance(2000 + 650);
    engine.respond('click', 'mouse');
    m.advance(2000 + 10_000); // no response for the whole window

    const [slow, missed] = engine.getRecords();
    expect(slow).toMatchObject({ reaction_time_ms: 650, is_lapse: 1, is_correct: 1 });
    expect(missed).toMatchObject({
      actual_response: 'none',
      is_lapse: 1,
      is_correct: 0,
      input_device: null,
    });
    expect(onFinish).toHaveBeenCalledWith(engine.getRecords(), 0);
  });

  it('pauses on interruption, discards the trial and repeats it on resume', () => {
    const { engine, m, onFinish } = pvtEngine([spec(2000)]);
    m.advance(2100);
    engine.interrupt();
    expect(engine.getState()).toMatchObject({
      status: 'interrupted',
      interruptions: 1,
      stimulusVisible: false,
    });
    m.advance(20_000);
    expect(engine.getRecords()).toHaveLength(0);

    engine.resume();
    expect(engine.getState()).toMatchObject({ status: 'foreperiod', index: 0 });
    m.advance(2000 + 280);
    engine.respond('click', 'keyboard');
    expect(engine.getRecords()).toHaveLength(1);
    expect(onFinish).toHaveBeenCalledWith(expect.any(Array), 1);
  });

  it('ignores early responses when false starts do not apply, and scores N-back omissions correctly', () => {
    const m = createManualClock();
    const specs = [
      spec(500, {
        stimulus_value: 'B',
        expected_response: 'no_match',
        stimulusMs: 500,
        responseWindowMs: 2000,
      }),
      spec(500, {
        stimulus_value: 'C',
        expected_response: 'match',
        stimulusMs: 500,
        responseWindowMs: 2000,
      }),
    ];
    const engine = createTrialEngine({
      definition: NBACK,
      phase: 'practice',
      specs,
      baseTimestamp: BASE,
      clock: m.clock,
      timers: m.timers,
    });
    engine.start();
    engine.respond('match', 'keyboard'); // during the foreperiod: ignored
    m.advance(500 + 500);
    expect(engine.getState().stimulusVisible).toBe(false); // stimulus hidden after 500 ms
    m.advance(1500); // window ends with no response on a non-target
    m.advance(500 + 2000); // missed target

    const [nonTarget, target] = engine.getRecords();
    expect(nonTarget).toMatchObject({
      actual_response: 'no_match',
      is_correct: 1,
      is_lapse: 0,
      is_false_start: 0,
      phase: 'practice',
    });
    expect(target).toMatchObject({ actual_response: 'no_match', is_correct: 0, is_lapse: 1 });
  });

  it('finishes after the last trial and ignores responses afterwards', () => {
    const { engine, m, onFinish } = pvtEngine([spec(2000)]);
    m.advance(2300);
    engine.respond('click', 'pen');
    expect(engine.getState().status).toBe('finished');
    engine.respond('click', 'pen');
    expect(engine.getRecords()).toHaveLength(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
