// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/rng';
import { NBACK, nbackSequence, PVT, STROOP } from './core';
import {
  parseRotation,
  REASONING,
  ROTATION,
  seriesItem,
  SWITCH,
  switchAnswer,
  SYMBOL,
  SYMBOL_KEY,
  taskSwitchSequence,
} from './extended';
import { buildSchedule, TEST_DEFINITIONS } from './registry';

describe('Phase 4A trial logic', () => {
  it('PVT: one signal per trial, click is correct, 10 s window', () => {
    const specs = PVT.generate(createRng(1), 5);
    expect(
      specs.every((s) => s.stimulus_type === 'visual_signal' && s.responseWindowMs === 10_000),
    ).toBe(true);
    expect(PVT.evaluate(specs[0]!, 'click')).toBe(true);
    expect(PVT.evaluate(specs[0]!, null)).toBe(false);
  });

  it('PVT: practice and test schedules have the plan counts', () => {
    expect(buildSchedule(PVT, 'x', 'practice')).toHaveLength(3);
    expect(buildSchedule(PVT, 'x', 'test')).toHaveLength(20);
  });

  it('2-back: targets match the letter two back and never occur in the first two trials', () => {
    const seq = nbackSequence(createRng(7), 200);
    expect(seq[0]!.expected_response).toBe('no_match');
    expect(seq[1]!.expected_response).toBe('no_match');
    seq.forEach((s, i) => {
      const isTarget = i >= 2 && s.stimulus_value === seq[i - 2]!.stimulus_value;
      expect(s.expected_response).toBe(isTarget ? 'match' : 'no_match');
    });
    const rate = seq.filter((s) => s.expected_response === 'match').length / 198;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.4);
  });

  it('2-back: a match on a target or silence on a non-target is correct', () => {
    const [target, nonTarget] = [
      { ...nbackSequence(createRng(1), 1)[0]!, expected_response: 'match' },
      { ...nbackSequence(createRng(1), 1)[0]!, expected_response: 'no_match' },
    ];
    expect(NBACK.evaluate(target, 'match')).toBe(true);
    expect(NBACK.evaluate(target, null)).toBe(false);
    expect(NBACK.evaluate(nonTarget, null)).toBe(true);
    expect(NBACK.evaluate(nonTarget, 'match')).toBe(false);
  });

  it('Stroop: the expected answer is the ink, and congruency is recorded', () => {
    const specs = STROOP.generate(createRng(3), 200);
    for (const s of specs) {
      const [word, ink] = s.stimulus_value.split('/') as [string, string];
      expect(s.expected_response).toBe(ink);
      expect(s.stimulus_type).toBe(
        word.toLowerCase() === ink ? 'colour_word_congruent' : 'colour_word_incongruent',
      );
    }
    const congruent = specs.filter((s) => s.stimulus_type === 'colour_word_congruent').length;
    expect(congruent).toBeGreaterThan(70);
    expect(congruent).toBeLessThan(130);
  });

  it('Stroop: answering with the word on an incongruent trial is incorrect', () => {
    const s = STROOP.generate(createRng(5), 100).find(
      (x) => x.stimulus_type === 'colour_word_incongruent',
    )!;
    const word = s.stimulus_value.split('/')[0]!.toLowerCase();
    expect(STROOP.evaluate(s, s.expected_response)).toBe(true);
    expect(STROOP.evaluate(s, word)).toBe(false);
  });
});

describe('Phase 4B trial logic', () => {
  it('Symbol-Digit: each symbol maps to its digit in the fixed key', () => {
    const specs = SYMBOL.generate(createRng(2), 50);
    for (const s of specs) expect(s.expected_response).toBe(SYMBOL_KEY[s.stimulus_value]);
    expect(Object.values(SYMBOL_KEY)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(SYMBOL.evaluate(specs[0]!, specs[0]!.expected_response)).toBe(true);
  });

  it('Mental rotation: mirrored shapes expect "mirror", rotations alone expect "same"', () => {
    const specs = ROTATION.generate(createRng(4), 60);
    for (const s of specs) {
      const { angle, mirrored } = parseRotation(s.stimulus_value);
      expect([0, 60, 120, 180, 240, 300]).toContain(angle);
      expect(s.expected_response).toBe(mirrored ? 'mirror' : 'same');
    }
    expect(specs.some((s) => s.expected_response === 'mirror')).toBe(true);
    expect(specs.some((s) => s.expected_response === 'same')).toBe(true);
  });

  it('Task switching: answers follow the current rule, and switch trials are marked', () => {
    expect(switchAnswer('parity', 7)).toBe('left');
    expect(switchAnswer('parity', 4)).toBe('right');
    expect(switchAnswer('magnitude', 3)).toBe('left');
    expect(switchAnswer('magnitude', 8)).toBe('right');
    const seq = taskSwitchSequence(createRng(9), 100);
    expect(seq[0]!.stimulus_type).toBe('repeat_trial');
    seq.forEach((s, i) => {
      const rule = s.display.rule;
      const prev = seq[i - 1]?.display.rule;
      expect(s.stimulus_type).toBe(i > 0 && rule !== prev ? 'switch_trial' : 'repeat_trial');
      expect(s.expected_response).toBe(switchAnswer(rule as 'parity', s.display.digit as number));
    });
    expect(SWITCH.evaluate(seq[0]!, seq[0]!.expected_response)).toBe(true);
  });

  it('Logical reasoning: the answer continues the series and is one of four distinct options', () => {
    for (let i = 0; i < 50; i += 1) {
      const item = seriesItem(createRng(i));
      expect(item.options).toHaveLength(4);
      expect(new Set(item.options).size).toBe(4);
      expect(item.options).toContain(item.answer);
    }
    const s = REASONING.generate(createRng(11), 1)[0]!;
    const options = REASONING.responsesFor!(s);
    expect(options.map((o) => o.keys[0])).toEqual(['1', '2', '3', '4']);
    expect(REASONING.evaluate(s, s.expected_response)).toBe(true);
    expect(Object.keys(TEST_DEFINITIONS)).toEqual([
      'PVT',
      'NBACK',
      'STROOP',
      'SYMBOL',
      'ROTATION',
      'SWITCH',
      'REASONING',
    ]);
  });
});
