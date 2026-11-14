import type { TrialPhase } from '@/api/types';
import { createRng, seedFrom } from '../engine/rng';
import type { TestDefinition, TrialSpec } from '../engine/types';
import { NBACK, PVT, STROOP } from './core';
import { REASONING, ROTATION, SWITCH, SYMBOL } from './extended';

/** Every engine test, keyed by assessment_protocols.protocol_id. SURVEY is a form. */
export const TEST_DEFINITIONS: Record<string, TestDefinition> = {
  PVT,
  NBACK,
  STROOP,
  SYMBOL,
  ROTATION,
  SWITCH,
  REASONING,
};

/**
 * The trial schedule for a session phase. It depends only on the definition and the
 * seed, never on the theme (preflight or Mission Mind), so timing and difficulty match.
 */
export function buildSchedule(
  definition: TestDefinition,
  seed: string,
  phase: TrialPhase,
  count = phase === 'practice' ? definition.practiceTrials : definition.testTrials,
): TrialSpec[] {
  return definition.generate(createRng(seedFrom(`${seed}|${phase}`)), count);
}

/** Mission Mind game names over the same protocols (BUILD_PLAN Phase 4B). */
export const MISSION_MIND_GAMES: Record<string, { name: string; skill: string }> = {
  PVT: { name: 'Signal Response', skill: 'Vigilance' },
  NBACK: { name: 'Memory Matrix', skill: 'Working memory (2-back)' },
  STROOP: { name: 'System Scanner', skill: 'Selective attention' },
  ROTATION: { name: 'Navigation Challenge', skill: 'Spatial reasoning' },
  SWITCH: { name: 'Command Switch', skill: 'Cognitive flexibility' },
};

export const CONDITION_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
  before_physical_work: 'Before physical work',
  after_physical_work: 'After physical work',
  before_mental_work: 'Before mental work',
  after_mental_work: 'After mental work',
  weekly_extended: 'Weekly extended',
};
