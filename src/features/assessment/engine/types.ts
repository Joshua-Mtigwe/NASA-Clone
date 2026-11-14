import type { InputDevice, TrialInput, TrialPhase } from '@/api/types';

/** One planned trial. Timing lives here, so a theme can never change it. */
export interface TrialSpec {
  stimulus_type: string;
  /** Encodes the stimulus, e.g. `K`, `RED/blue`, `rule:parity;digit:7;switch:1`. */
  stimulus_value: string;
  expected_response: string;
  /** Blank interval before the stimulus appears. */
  foreperiodMs: number;
  /** How long the stimulus stays visible; null = until response or window end. */
  stimulusMs: number | null;
  /** Time allowed to respond, measured from stimulus onset. */
  responseWindowMs: number;
  /** Renderer-only data (letter, ink colour, options...). Never read by scoring. */
  display: Record<string, unknown>;
}

export interface ResponseOption {
  value: string;
  label: string;
  /** KeyboardEvent.key values that give this response. */
  keys: string[];
}

export interface Rng {
  next(): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

export interface TestDefinition {
  protocolId: string;
  testVersion: string;
  title: string;
  instructions: string[];
  practiceTrials: number;
  testTrials: number;
  responses: ResponseOption[];
  /** Per-trial options (e.g. multiple choice); defaults to `responses`. */
  responsesFor?: (spec: TrialSpec) => ResponseOption[];
  /** Responses before onset are recorded as false starts (PVT). */
  falseStartDetection: boolean;
  /** A response this slow (ms) or none at all is a lapse (PVT: 500). */
  lapseThresholdMs: number | null;
  /** actual_response recorded when nobody responds. */
  noResponseValue: string;
  itiMs: number;
  generate: (rng: Rng, count: number) => TrialSpec[];
  /** Is `response` (null = no response) correct for this trial? */
  evaluate: (spec: TrialSpec, response: string | null) => boolean;
}

/** What the engine records: the CSV trial columns plus local metadata. */
export interface EngineTrialRecord extends TrialInput {
  phase: TrialPhase;
  input_device: InputDevice | null;
  test_version: string;
  /** performance.now() at stimulus onset (or at the false start). */
  onset_ms: number;
}

export type EngineStatus = 'idle' | 'foreperiod' | 'stimulus' | 'iti' | 'interrupted' | 'finished';

export interface EngineState {
  status: EngineStatus;
  index: number;
  total: number;
  spec: TrialSpec | null;
  stimulusVisible: boolean;
  interruptions: number;
}

export interface Clock {
  now(): number;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
