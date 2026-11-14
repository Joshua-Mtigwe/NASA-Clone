/** Phase 4B tests: Symbol-Digit, Mental Rotation, Task Switching, Logical Reasoning. */
import type { ResponseOption, Rng, TestDefinition, TrialSpec } from '../engine/types';

// ---------- Symbol-Digit Matching ----------

export const SYMBOLS = ['◆', '●', '▲', '■', '★', '✚', '◐', '⬟', '✱'] as const;
/** Fixed key for this test version: symbol i maps to digit i + 1. */
export const SYMBOL_KEY: Record<string, string> = Object.fromEntries(
  SYMBOLS.map((s, i) => [s, String(i + 1)]),
);

export const SYMBOL: TestDefinition = {
  protocolId: 'SYMBOL',
  testVersion: 'sdmt-v1',
  title: 'Symbol-Digit Matching',
  instructions: [
    'A key at the top pairs each symbol with a digit.',
    'For each symbol shown, press its digit (1–9) as quickly and accurately as you can.',
  ],
  practiceTrials: 3,
  testTrials: 30,
  responses: SYMBOLS.map((_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
    keys: [String(i + 1)],
  })),
  falseStartDetection: false,
  lapseThresholdMs: null,
  noResponseValue: 'none',
  itiMs: 0,
  generate: (rng, count) =>
    Array.from({ length: count }, () => {
      const symbol = rng.pick(SYMBOLS);
      return {
        stimulus_type: 'symbol',
        stimulus_value: symbol,
        expected_response: SYMBOL_KEY[symbol]!,
        foreperiodMs: 300,
        stimulusMs: null,
        responseWindowMs: 5000,
        display: { symbol },
      };
    }),
  evaluate: (spec, response) => response === spec.expected_response,
};

// ---------- Mental Rotation (Navigation Challenge) ----------

/** An asymmetric polyomino; mirrored copies cannot be rotated onto it. */
export const ROTATION_SHAPE: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [2, 3],
];
export const ROTATION_ANGLES = [0, 60, 120, 180, 240, 300] as const;

export function parseRotation(value: string): { angle: number; mirrored: boolean } {
  const parts = Object.fromEntries(value.split(';').map((p) => p.split(':') as [string, string]));
  return { angle: Number(parts.angle), mirrored: parts.mirror === '1' };
}

export const ROTATION: TestDefinition = {
  protocolId: 'ROTATION',
  testVersion: 'rotation-v1',
  title: 'Mental Rotation',
  instructions: [
    'Two shapes appear. The right one is rotated.',
    'Decide whether it is the SAME shape (F) or a MIRROR image (J).',
  ],
  practiceTrials: 3,
  testTrials: 16,
  responses: [
    { value: 'same', label: 'Same', keys: ['f', 'F'] },
    { value: 'mirror', label: 'Mirror', keys: ['j', 'J'] },
  ],
  falseStartDetection: false,
  lapseThresholdMs: null,
  noResponseValue: 'none',
  itiMs: 0,
  generate: (rng, count) =>
    Array.from({ length: count }, () => {
      const angle = rng.pick(ROTATION_ANGLES);
      const mirrored = rng.next() < 0.5;
      return {
        stimulus_type: 'rotated_shape',
        stimulus_value: `angle:${angle};mirror:${mirrored ? 1 : 0}`,
        expected_response: mirrored ? 'mirror' : 'same',
        foreperiodMs: 500,
        stimulusMs: null,
        responseWindowMs: 7000,
        display: { angle, mirrored },
      };
    }),
  evaluate: (spec, response) => response === spec.expected_response,
};

// ---------- Task Switching (Command Switch) ----------

export type SwitchRule = 'parity' | 'magnitude';
const DIGITS = [1, 2, 3, 4, 6, 7, 8, 9] as const;

/** parity: odd = left, even = right. magnitude: below 5 = left, above 5 = right. */
export function switchAnswer(rule: SwitchRule, digit: number): 'left' | 'right' {
  if (rule === 'parity') return digit % 2 === 1 ? 'left' : 'right';
  return digit < 5 ? 'left' : 'right';
}

export function taskSwitchSequence(rng: Rng, count: number, switchRate = 0.5): TrialSpec[] {
  let rule: SwitchRule = rng.next() < 0.5 ? 'parity' : 'magnitude';
  return Array.from({ length: count }, (_, i) => {
    const switched = i > 0 && rng.next() < switchRate;
    if (switched) rule = rule === 'parity' ? 'magnitude' : 'parity';
    const digit = rng.pick(DIGITS);
    return {
      stimulus_type: switched ? 'switch_trial' : 'repeat_trial',
      stimulus_value: `rule:${rule};digit:${digit};switch:${switched ? 1 : 0}`,
      expected_response: switchAnswer(rule, digit),
      foreperiodMs: 400,
      stimulusMs: null,
      responseWindowMs: 4000,
      display: { rule, digit },
    };
  });
}

export const SWITCH: TestDefinition = {
  protocolId: 'SWITCH',
  testVersion: 'switch-v1',
  title: 'Task Switching',
  instructions: [
    'A rule and a digit appear. The rule can change between trials.',
    'ODD / EVEN rule: odd = Left (F), even = Right (J).',
    'LOW / HIGH rule: below 5 = Left (F), above 5 = Right (J).',
  ],
  practiceTrials: 4,
  testTrials: 24,
  responses: [
    { value: 'left', label: 'Left', keys: ['f', 'F'] },
    { value: 'right', label: 'Right', keys: ['j', 'J'] },
  ],
  falseStartDetection: false,
  lapseThresholdMs: null,
  noResponseValue: 'none',
  itiMs: 0,
  generate: (rng, count) => taskSwitchSequence(rng, count),
  evaluate: (spec, response) => response === spec.expected_response,
};

// ---------- Logical Reasoning quiz ----------

export function seriesItem(rng: Rng): { terms: number[]; answer: number; options: number[] } {
  const kind = rng.pick(['arithmetic', 'geometric', 'alternating'] as const);
  const start = rng.int(1, 12);
  let terms: number[];
  let answer: number;
  if (kind === 'arithmetic') {
    const step = rng.int(2, 9);
    terms = [0, 1, 2, 3].map((i) => start + i * step);
    answer = start + 4 * step;
  } else if (kind === 'geometric') {
    const ratio = rng.int(2, 3);
    terms = [0, 1, 2, 3].map((i) => start * ratio ** i);
    answer = start * ratio ** 4;
  } else {
    const a = rng.int(2, 6);
    const b = rng.int(7, 12);
    terms = [start, start + a, start + a + b, start + 2 * a + b];
    answer = start + 2 * a + 2 * b;
  }
  const distractors = new Set<number>();
  for (const d of [answer + 1, answer - 1, answer + 2, answer - 2, answer + 3, answer * 2]) {
    if (d !== answer && d > 0 && distractors.size < 3) distractors.add(d);
  }
  const options = [answer, ...distractors];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return { terms, answer, options };
}

export const REASONING: TestDefinition = {
  protocolId: 'REASONING',
  testVersion: 'series-v1',
  title: 'Logical Reasoning',
  instructions: [
    'Each item shows a number series.',
    'Choose the number that comes next, with keys 1–4 or by tapping an option.',
  ],
  practiceTrials: 1,
  testTrials: 10,
  responses: [],
  responsesFor: (spec): ResponseOption[] =>
    (spec.display.options as number[]).map((n, i) => ({
      value: String(n),
      label: String(n),
      keys: [String(i + 1)],
    })),
  falseStartDetection: false,
  lapseThresholdMs: null,
  noResponseValue: 'none',
  itiMs: 0,
  generate: (rng, count) =>
    Array.from({ length: count }, () => {
      const item = seriesItem(rng);
      return {
        stimulus_type: 'number_series',
        stimulus_value: `series:${item.terms.join(',')}`,
        expected_response: String(item.answer),
        foreperiodMs: 200,
        stimulusMs: null,
        responseWindowMs: 30_000,
        display: { terms: item.terms, options: item.options },
      };
    }),
  evaluate: (spec, response) => response === spec.expected_response,
};
