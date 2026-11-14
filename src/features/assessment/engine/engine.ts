/**
 * Shared trial engine. Schedules each trial (randomised foreperiod, onset, response
 * window, inter-trial interval), timestamps with the injected clock
 * (performance.now() in the app), detects false starts, lapses and interruptions,
 * and emits CSV-shaped trial records. It scores nothing: is_correct / is_lapse /
 * is_false_start are the raw trial facts the backend scores from.
 */
import type { InputDevice, TrialPhase } from '@/api/types';
import type {
  Clock,
  EngineState,
  EngineTrialRecord,
  TestDefinition,
  Timers,
  TrialSpec,
} from './types';

export const browserClock: Clock = { now: () => performance.now() };
export const browserTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (h) => window.clearTimeout(h as number),
};

export interface EngineOptions {
  definition: TestDefinition;
  phase: TrialPhase;
  specs: TrialSpec[];
  /** ISO timestamp the session started at (mission clock). Trial times offset from it. */
  baseTimestamp: string;
  clock?: Clock;
  timers?: Timers;
  onChange?: (state: EngineState) => void;
  onFinish?: (records: EngineTrialRecord[], interruptions: number) => void;
}

export interface TrialEngine {
  start(): void;
  respond(value: string, device: InputDevice): void;
  interrupt(): void;
  resume(): void;
  stop(): void;
  getState(): EngineState;
  getRecords(): EngineTrialRecord[];
}

export function createTrialEngine(options: EngineOptions): TrialEngine {
  const { definition, phase, specs } = options;
  const clock = options.clock ?? browserClock;
  const timers = options.timers ?? browserTimers;
  const base = Date.parse(options.baseTimestamp);

  const records: EngineTrialRecord[] = [];
  const pending: unknown[] = [];
  let state: EngineState = {
    status: 'idle',
    index: 0,
    total: specs.length,
    spec: null,
    stimulusVisible: false,
    interruptions: 0,
  };
  let startedAt = 0;
  let foreperiodStart = 0;
  let onsetAt = 0;
  let responded = false;

  const set = (patch: Partial<EngineState>) => {
    state = { ...state, ...patch };
    options.onChange?.(state);
  };
  const schedule = (fn: () => void, ms: number) => pending.push(timers.set(fn, ms));
  const clearAll = () => {
    while (pending.length) timers.clear(pending.pop());
  };
  const isoAt = (perfMs: number) =>
    new Date(base + Math.max(0, perfMs - startedAt)).toISOString().replace(/\.\d{3}Z$/, 'Z');

  function runTrial() {
    if (state.index >= specs.length) {
      clearAll();
      set({ status: 'finished', spec: null, stimulusVisible: false });
      options.onFinish?.(records, state.interruptions);
      return;
    }
    const spec = specs[state.index]!;
    responded = false;
    foreperiodStart = clock.now();
    set({ status: 'foreperiod', spec, stimulusVisible: false });
    schedule(onset, spec.foreperiodMs);
  }

  function onset() {
    const spec = state.spec!;
    onsetAt = clock.now();
    set({ status: 'stimulus', stimulusVisible: true });
    if (spec.stimulusMs !== null) schedule(() => set({ stimulusVisible: false }), spec.stimulusMs);
    schedule(() => finalize(null, null), spec.responseWindowMs);
  }

  function record(
    spec: TrialSpec,
    response: string | null,
    rt: number,
    device: InputDevice | null,
    falseStart: boolean,
    at: number,
  ) {
    const lapse =
      !falseStart &&
      ((response === null && spec.expected_response !== definition.noResponseValue) ||
        (definition.lapseThresholdMs !== null &&
          (response === null || rt >= definition.lapseThresholdMs)));
    records.push({
      trial_number: state.index + 1,
      stimulus_type: spec.stimulus_type,
      stimulus_value: spec.stimulus_value,
      expected_response: spec.expected_response,
      actual_response: response ?? definition.noResponseValue,
      reaction_time_ms: Math.round(rt * 10) / 10,
      is_correct: !falseStart && definition.evaluate(spec, response) ? 1 : 0,
      is_lapse: lapse ? 1 : 0,
      is_false_start: falseStart ? 1 : 0,
      trial_timestamp: isoAt(at),
      phase,
      input_device: device,
      test_version: definition.testVersion,
      onset_ms: at,
    });
  }

  function advance() {
    clearAll();
    set({ status: 'iti', stimulusVisible: false, index: state.index + 1 });
    if (definition.itiMs > 0) schedule(runTrial, definition.itiMs);
    else runTrial();
  }

  function finalize(response: string | null, device: InputDevice | null) {
    if (responded) return;
    responded = true;
    const spec = state.spec!;
    const rt = response === null ? spec.responseWindowMs : clock.now() - onsetAt;
    record(spec, response, rt, device, false, onsetAt);
    advance();
  }

  return {
    start() {
      if (state.status !== 'idle') return;
      startedAt = clock.now();
      runTrial();
    },
    respond(value, device) {
      if (state.status === 'stimulus') {
        finalize(value, device);
      } else if (state.status === 'foreperiod' && definition.falseStartDetection) {
        // Anticipation: negative RT = ms before the planned onset.
        const spec = state.spec!;
        const now = clock.now();
        record(spec, value, now - (foreperiodStart + spec.foreperiodMs), device, true, now);
        advance();
      }
      // Responses during the ITI, before start or after the end are ignored.
    },
    interrupt() {
      if (!['foreperiod', 'stimulus', 'iti'].includes(state.status)) return;
      clearAll();
      // The interrupted trial is discarded and re-run on resume.
      set({
        status: 'interrupted',
        stimulusVisible: false,
        interruptions: state.interruptions + 1,
      });
    },
    resume() {
      if (state.status === 'interrupted') runTrial();
    },
    stop() {
      clearAll();
    },
    getState: () => state,
    getRecords: () => records,
  };
}
