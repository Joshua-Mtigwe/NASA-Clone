// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { mockState, resetMockDb, table } from '../db';
import {
  checkConditions,
  ensureDemoAssignments,
  MISSION_MIND_TEMPLATE,
  missionMindGamesFor,
  missionMindSummary,
  PREFLIGHT_TEMPLATE,
} from './scheduler';

beforeEach(() => {
  resetMockDb();
  mockState.missionDayOverride = 25;
});

describe('mock assessment scheduler', () => {
  it('creates the demo assignments once per astronaut-day and rotates two Mission Mind games', async () => {
    await ensureDemoAssignments('AST-001');
    await ensureDemoAssignments('AST-001');
    const mine = (await table('assessment_assignments')).filter(
      (a) => a.astronaut_id === 'AST-001' && a.assignment_source === 'mock_demo_scheduler',
    );
    expect(mine.filter((a) => a.schedule_template_id === PREFLIGHT_TEMPLATE)).toHaveLength(8);
    expect(
      mine
        .filter((a) => a.schedule_template_id === MISSION_MIND_TEMPLATE)
        .map((a) => a.protocol_id),
    ).toEqual(['SWITCH', 'PVT', 'SURVEY']);
    expect(new Set([1, 2, 3, 4, 5].flatMap(missionMindGamesFor)).size).toBe(5);
  });

  it('decides conditions at the mission clock and counts the streak of completed days', async () => {
    expect(await checkConditions('morning', 'AST-001')).toEqual({ met: true, reason: null });
    expect((await checkConditions('night', 'AST-001')).met).toBe(false);
    expect((await checkConditions('weekly_extended', 'AST-001')).met).toBe(false);

    const summary = await missionMindSummary('AST-001');
    // CSV inflight sessions run daily from day 1; today's 08:00 sessions are complete by 12:00.
    expect(summary.streak_days).toBe(25);
    expect(summary.sessions_scheduled_today).toBe(3);
    expect(summary.estimate_seconds).toBe(180 + 180 + 60);
  });
});
