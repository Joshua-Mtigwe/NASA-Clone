import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { assessmentsApi } from '@/api/assessments';
import { mockState } from '@/mocks/db';
import { server } from '@/mocks/server';
import { setupMockApi, signInAs } from '@/test/appHarness';
import { localDb } from './db';
import { enqueueCompletion, enqueueTrials, flushQueue } from './queue';

setupMockApi();
beforeEach(async () => {
  mockState.missionDayOverride = 25;
  await localDb.outbox.clear();
  await localDb.completions.clear();
});

async function startPvtSession() {
  await signInAs('astronaut');
  const due = await assessmentsApi.due('AST-001');
  const pvt = due.find((d) => d.protocol.protocol_id === 'PVT' && d.mission_phase === 'preflight')!;
  return assessmentsApi.startSession({ assignment_id: pvt.assignment.assignment_id });
}

const trial = (n: number, rt: number) => ({
  trial_number: n,
  stimulus_type: 'visual_signal',
  stimulus_value: 'target',
  expected_response: 'click',
  actual_response: 'click',
  reaction_time_ms: rt,
  is_correct: 1,
  is_lapse: 0,
  is_false_start: 0,
  trial_timestamp: '2027-03-25T12:00:00Z',
});

describe('offline queue', () => {
  it('writes to IndexedDB before any network call, then flushes in order and stores the scores', async () => {
    const session = await startPvtSession();
    const requests: string[] = [];
    server.events.on('request:start', ({ request }) =>
      requests.push(new URL(request.url).pathname),
    );

    await enqueueTrials(session.session_id, {
      trials: [trial(1, 300), trial(2, 340)],
      phase: 'test',
      input_device: 'keyboard',
      test_version: 'pvt-v1',
    });
    await enqueueCompletion(session.session_id, { completed_at: '2027-03-25T12:03:00Z' });
    expect(await localDb.outbox.count()).toBe(2);
    expect(requests).toHaveLength(0);

    const result = await flushQueue();
    server.events.removeAllListeners();
    expect(result).toEqual({ sent: 2, remaining: 0, offline: false });
    expect(requests).toEqual([
      `/api/v1/assessments/sessions/${session.session_id}/trials`,
      `/api/v1/assessments/sessions/${session.session_id}/complete`,
    ]);
    const stored = await localDb.completions.get(session.session_id);
    expect(stored?.completion.results[0]).toMatchObject({
      metric_name: 'median_reaction_time_ms',
      metric_value: 320,
    });
  });

  it('keeps items queued while the API is unreachable and sends them on the next flush', async () => {
    const session = await startPvtSession();
    await enqueueTrials(session.session_id, {
      trials: [trial(1, 310)],
      phase: 'test',
      input_device: 'mouse',
      test_version: 'pvt-v1',
    });
    await enqueueCompletion(session.session_id, { completed_at: '2027-03-25T12:03:00Z' });

    server.use(http.post('*/api/v1/assessments/sessions/:id/trials', () => HttpResponse.error()));
    expect(await flushQueue()).toEqual({ sent: 0, remaining: 2, offline: true });
    const [first] = await localDb.outbox.orderBy('seq').toArray();
    expect(first).toMatchObject({ status: 'pending', attempts: 1 });

    server.resetHandlers();
    expect(await flushQueue()).toEqual({ sent: 2, remaining: 0, offline: false });
  });

  it('marks a rejected item failed and holds back the rest of that session', async () => {
    await signInAs('astronaut');
    await enqueueTrials('SES-DOES-NOT-EXIST', {
      trials: [trial(1, 300)],
      phase: 'test',
      input_device: null,
      test_version: 'pvt-v1',
    });
    await enqueueCompletion('SES-DOES-NOT-EXIST', { completed_at: '2027-03-25T12:03:00Z' });

    expect(await flushQueue()).toEqual({ sent: 0, remaining: 2, offline: false });
    const items = await localDb.outbox.orderBy('seq').toArray();
    expect(items.map((i) => i.status)).toEqual(['failed', 'pending']);
    expect(items[0]!.lastError).toBe('Session not found.');
    expect(items[1]!.attempts).toBe(0);
  });
});
