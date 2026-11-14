/** Phase 4A core battery: PVT, 2-back and Stroop. */
import type { Rng, TestDefinition, TrialSpec } from '../engine/types';

export const PVT: TestDefinition = {
  protocolId: 'PVT',
  testVersion: 'pvt-v1',
  title: 'Psychomotor Vigilance Test',
  instructions: [
    'Watch the signal area. After a random wait, the signal turns on.',
    'Respond as fast as you can: press Space or Enter, or tap the signal area.',
    'Do not respond before the signal appears. Early responses are recorded as false starts.',
  ],
  practiceTrials: 3,
  testTrials: 20,
  responses: [{ value: 'click', label: 'Respond', keys: [' ', 'Enter'] }],
  falseStartDetection: true,
  lapseThresholdMs: 500,
  noResponseValue: 'none',
  itiMs: 0,
  generate: (rng, count) =>
    Array.from({ length: count }, () => ({
      stimulus_type: 'visual_signal',
      stimulus_value: 'target',
      expected_response: 'click',
      foreperiodMs: rng.int(2000, 10000),
      stimulusMs: null,
      responseWindowMs: 10_000,
      display: {},
    })),
  evaluate: (_spec, response) => response === 'click',
};

const LETTERS = ['B', 'C', 'D', 'F', 'G', 'H', 'J', 'K'] as const;

/** 2-back letter sequence with ~30% targets; the first two trials cannot be targets. */
export function nbackSequence(rng: Rng, count: number, targetRate = 0.3): TrialSpec[] {
  const letters: string[] = [];
  return Array.from({ length: count }, (_, i) => {
    const twoBack = letters[i - 2];
    const target = twoBack !== undefined && rng.next() < targetRate;
    const letter = target ? twoBack! : rng.pick(LETTERS.filter((l) => l !== twoBack));
    letters.push(letter);
    return {
      stimulus_type: 'letter',
      stimulus_value: letter,
      expected_response: target ? 'match' : 'no_match',
      foreperiodMs: 500,
      stimulusMs: 500,
      responseWindowMs: 2000,
      display: { letter },
    };
  });
}

export const NBACK: TestDefinition = {
  protocolId: 'NBACK',
  testVersion: 'nback2-v1',
  title: 'N-Back (2-back)',
  instructions: [
    'Letters appear one at a time.',
    'Respond "Match" (J or Space) when the letter is the same as the one two letters back.',
    'Otherwise do nothing.',
  ],
  practiceTrials: 6,
  testTrials: 20,
  responses: [{ value: 'match', label: 'Match', keys: ['j', 'J', ' '] }],
  falseStartDetection: false,
  lapseThresholdMs: null,
  noResponseValue: 'no_match',
  itiMs: 0,
  generate: (rng, count) => nbackSequence(rng, count),
  evaluate: (spec, response) => (response ?? 'no_match') === spec.expected_response,
};

export const STROOP_COLOURS = ['red', 'green', 'blue', 'yellow'] as const;
export type StroopColour = (typeof STROOP_COLOURS)[number];

/** Ink colours (CSS) and the same values as numbers for PixiJS. */
export const STROOP_INK: Record<StroopColour, string> = {
  red: '#f87171',
  green: '#4ade80',
  blue: '#60a5fa',
  yellow: '#facc15',
};
export const INK_HEX: Record<StroopColour, number> = {
  red: 0xf87171,
  green: 0x4ade80,
  blue: 0x60a5fa,
  yellow: 0xfacc15,
};

export const STROOP: TestDefinition = {
  protocolId: 'STROOP',
  testVersion: 'stroop-v1',
  title: 'Stroop colour-word',
  instructions: [
    'A colour word appears in coloured ink.',
    'Respond with the INK colour, not the word: R red, G green, B blue, Y yellow.',
  ],
  practiceTrials: 4,
  testTrials: 20,
  responses: STROOP_COLOURS.map((c) => ({
    value: c,
    label: c[0]!.toUpperCase() + c.slice(1),
    keys: [c[0]!, c[0]!.toUpperCase()],
  })),
  falseStartDetection: false,
  lapseThresholdMs: null,
  noResponseValue: 'none',
  itiMs: 0,
  generate: (rng, count) =>
    Array.from({ length: count }, () => {
      const word = rng.pick(STROOP_COLOURS);
      const congruent = rng.next() < 0.5;
      const ink = congruent ? word : rng.pick(STROOP_COLOURS.filter((c) => c !== word));
      return {
        stimulus_type: congruent ? 'colour_word_congruent' : 'colour_word_incongruent',
        stimulus_value: `${word.toUpperCase()}/${ink}`,
        expected_response: ink,
        foreperiodMs: rng.int(500, 1000),
        stimulusMs: null,
        responseWindowMs: 3000,
        display: { word: word.toUpperCase(), ink },
      };
    }),
  evaluate: (spec, response) => response === spec.expected_response,
};
