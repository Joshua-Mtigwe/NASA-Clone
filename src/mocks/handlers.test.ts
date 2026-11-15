// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessmentsApi } from '@/api/assessments';
import { astronautsApi } from '@/api/astronauts';
import { authApi } from '@/api/auth';
import { configureApiClient } from '@/api/client';
import { ENDPOINTS, UNMOCKED_ENDPOINTS } from '@/api/endpoints';
import { missionsApi } from '@/api/missions';
import { mockState, resetMockDb } from './db';
import { handledEndpoints } from './handlers';
import { server } from './server';
import { MOCK_DEMO_PASSWORD } from './session';

let token: string | null = null;
const onForbidden = vi.fn();

async function signIn(username: string) {
  const res = await authApi.login({ username, password: MOCK_DEMO_PASSWORD });
  token = res.access_token;
  return res.user;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  configureApiClient({ baseUrl: 'http://localhost', getToken: () => token, onForbidden });
});
beforeEach(() => {
  resetMockDb();
  token = null;
  onForbidden.mockClear();
});
afterAll(() => server.close());

describe('mock API', () => {
  it('has a handler for every endpoint in the contract except genuine AI service endpoints', () => {
    const mocked = Object.keys(ENDPOINTS).filter(
      (k) => !(UNMOCKED_ENDPOINTS as readonly string[]).includes(k),
    );
    expect([...handledEndpoints].sort()).toEqual(mocked.sort());
    expect(UNMOCKED_ENDPOINTS.every((k) => k.startsWith('mindChat.') || k.startsWith('ai.'))).toBe(
      true,
    );
  });

  it('logs in a CSV demo account, rejects a wrong password, and serves synthetic mission state', async () => {
    const user = await signIn('crew1');
    expect(user).toEqual({
      user_id: 'USR-001',
      username: 'crew1',
      role_id: 'ROLE-1',
      role: 'astronaut',
      astronaut_id: 'AST-001',
    });
    await expect(authApi.login({ username: 'crew1', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
    });

    const state = await missionsApi.currentState();
    expect(state.mission.mission_id).toBe('MIS-001');
    expect(state.mission_length_days).toBe(90);
    expect(state.mission_day).toBe(1);
    expect(state.is_synthetic).toBe(true);
  });

  it('returns 403 to a mission leader asking for health data and to an astronaut reading another astronaut', async () => {
    await signIn('mission_leader');
    await expect(astronautsApi.baselines('AST-001')).rejects.toMatchObject({ kind: 'forbidden' });
    expect(onForbidden).toHaveBeenCalledTimes(1);

    await signIn('crew1');
    await expect(astronautsApi.baselines('AST-002')).rejects.toMatchObject({
      kind: 'forbidden',
      message: 'Astronauts can only access their own records.',
    });
    const own = await astronautsApi.baselines('AST-001');
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((b) => b.astronaut_id === 'AST-001')).toBe(true);
  });

  it('gates a session on medical-officer access and returns the backend score on completion', async () => {
    mockState.missionDayOverride = 1; // 12:00 UTC: inside the morning window
    await signIn('medical_officer');
    const assignments = await assessmentsApi.createAssignments({
      astronaut_ids: ['AST-001'],
      template_id: 'TPL-FLIGHT',
      scheduled_at: '2027-03-01T08:00:00Z',
    });
    const pvt = assignments.find((a) => a.protocol_id === 'PVT')!;

    await signIn('crew1');
    const due = await assessmentsApi.due('AST-001');
    expect(due.find((d) => d.assignment.assignment_id === pvt.assignment_id)).toMatchObject({
      authorized: false,
    });
    await expect(
      assessmentsApi.startSession({
        assignment_id: pvt.assignment_id,
        started_at: '2027-03-01T08:00:00Z',
      }),
    ).rejects.toMatchObject({ kind: 'forbidden' });

    await signIn('medical_officer');
    await assessmentsApi.grantAccess(pvt.assignment_id, {
      access_expires_at: '2027-03-01T09:00:00Z',
    });

    await signIn('crew1');
    const session = await assessmentsApi.startSession({
      assignment_id: pvt.assignment_id,
      started_at: '2027-03-01T08:00:00Z',
    });
    const trial = (n: number, rt: number, falseStart = 0) => ({
      trial_number: n,
      stimulus_type: 'visual_signal',
      stimulus_value: 'target',
      expected_response: 'click',
      actual_response: 'click',
      reaction_time_ms: rt,
      is_correct: 1,
      is_lapse: 0,
      is_false_start: falseStart,
      trial_timestamp: '2027-03-01T08:00:00Z',
    });
    await assessmentsApi.submitTrials(session.session_id, {
      trials: [trial(1, 300), trial(2, 320), trial(3, 100, 1), trial(4, 340)],
      phase: 'test',
      input_device: 'mouse',
      test_version: 'v1',
    });
    const done = await assessmentsApi.completeSession(session.session_id, {
      completed_at: '2027-03-01T08:03:00Z',
    });

    expect(done.session.session_status).toBe('completed');
    expect(done.results).toHaveLength(1);
    expect(done.results[0]).toMatchObject({
      cognitive_domain: 'vigilance',
      metric_name: 'median_reaction_time_ms',
      metric_value: 320,
      metric_unit: 'ms',
    });
  });
});
