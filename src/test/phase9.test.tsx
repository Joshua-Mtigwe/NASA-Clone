import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assessmentsApi } from '@/api/assessments';
import { missionsApi } from '@/api/missions';
import { simulationApi } from '@/api/simulation';
import { localDb } from '@/features/assessment/offline/db';
import {
  enqueueCompletion,
  enqueueContext,
  enqueueOverride,
  flushQueue,
  startQueueSync,
} from '@/features/assessment/offline/queue';
import { realtimeUrl } from '@/features/realtime/url';
import { mockState } from '@/mocks/db';
import { shouldRegisterPwa } from '@/pwa';
import { renderApp, setupMockApi, signInAs, signInBackendOnly } from './appHarness';

setupMockApi();

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

beforeEach(async () => {
  mockState.missionDayOverride = 25;
  await localDb.outbox.clear();
  await localDb.completions.clear();
});
afterEach(() => setOnline(true));

async function startSurvey() {
  await signInAs('astronaut');
  const due = await assessmentsApi.due('AST-001');
  const survey = due.find(
    (d) => d.protocol.protocol_id === 'SURVEY' && d.mission_phase === 'preflight',
  )!;
  return assessmentsApi.startSession({ assignment_id: survey.assignment.assignment_id });
}

const context = (fatigue: number) => ({
  astronaut_id: 'AST-001',
  mission_id: 'MIS-001',
  timestamp_utc: '2027-03-25T12:00:00Z',
  circadian_condition: 'morning',
  preceding_activity: 'routine',
  prior_sleep_hours: 7,
  fatigue_score: fatigue,
  sleepiness_score: 3,
  perceived_workload: 4,
  time_since_waking_minutes: 120,
  source_type: 'self_report',
  sleep_quality_score: 6,
});

describe('offline queues', () => {
  it('queues a check-in offline and sends it before the completion when back online', async () => {
    const session = await startSurvey();
    setOnline(false);
    await enqueueContext(session.session_id, context(7));
    await enqueueCompletion(session.session_id, { completed_at: '2027-03-25T12:02:00Z' });
    expect(await flushQueue()).toMatchObject({ sent: 0, remaining: 2, offline: true });

    setOnline(true);
    expect(await flushQueue()).toMatchObject({ sent: 2, remaining: 0 });
    const stored = await localDb.completions.get(session.session_id);
    expect(stored?.completion.results[0]).toMatchObject({
      metric_name: 'fatigue_score',
      metric_value: 7,
    });
  });

  it('flushes a queued schedule override when the browser comes back online', async () => {
    await signInAs('mission_leader');
    const { planningApi } = await import('@/api/planning');
    await planningApi.listSchedules({ task_set_id: 'SET-025' });
    const detail = await planningApi.getSchedule('SV-SET-025-1');
    const target = detail.assignments[0]!;
    setOnline(false);
    await enqueueOverride('SV-SET-025-1', {
      task_assignment_id: target.task_assignment_id,
      planned_start: '2027-03-25T07:30:00Z',
      reason: 'Made offline',
    });
    const stop = startQueueSync(60_000);
    expect(await localDb.outbox.count()).toBe(1);

    setOnline(true); // the 'online' event triggers a flush
    await waitFor(async () => expect(await localDb.outbox.count()).toBe(0));
    stop();
    const after = await planningApi.getSchedule('SV-SET-025-1');
    expect(
      after.assignments.find((a) => a.task_assignment_id === target.task_assignment_id)
        ?.planned_start,
    ).toBe('2027-03-25T07:30:00Z');
  });

  it('shows Syncing in the header while items wait in the queue, then Synced', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/alerts');
    const header = await screen.findByRole('banner', { name: 'Mission status' });
    await waitFor(
      () =>
        expect(
          within(header).getByRole('status', { name: 'Connection: Synced' }),
        ).toBeInTheDocument(),
      { timeout: 5000 },
    );

    setOnline(false);
    await localDb.outbox.add({
      kind: 'complete',
      sessionId: 'S-X',
      payload: { completed_at: 'x' },
      createdAt: 'x',
      attempts: 0,
      status: 'pending',
      lastError: null,
    });
    setOnline(true);
    await waitFor(() =>
      expect(
        within(header).getByRole('status', { name: /Connection: (Syncing|Synced)/ }),
      ).toBeInTheDocument(),
    );
    await localDb.outbox.clear();
    await waitFor(
      () =>
        expect(
          within(header).getByRole('status', { name: 'Connection: Synced' }),
        ).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('saves a schedule override on the device when offline and says so', async () => {
    await signInAs('mission_leader');
    renderApp('/planner/schedule');
    await waitFor(() => expect(screen.getAllByTestId('task-bar').length).toBeGreaterThan(0), {
      timeout: 5000,
    });
    await userEvent.click(screen.getAllByTestId('task-bar')[0]!);
    const form = screen.getByRole('form', { name: 'Manual override' });
    await userEvent.type(within(form).getByLabelText(/Reason for override/), 'No signal');
    setOnline(false);
    await userEvent.click(within(form).getByRole('button', { name: 'Apply override' }));
    expect(await within(form).findByText(/Saved on this device/)).toBeInTheDocument();
    expect(await localDb.outbox.count()).toBe(1);
  });
});

describe('mock server offline behaviour', () => {
  it('behaves like an unreachable server while the browser is offline', async () => {
    setOnline(false);
    await expect(missionsApi.currentState()).rejects.toMatchObject({ kind: 'network', status: 0 });
    setOnline(true);
    await expect(missionsApi.currentState()).resolves.toMatchObject({ mission_day: 25 });
  });
});

describe('PWA, realtime and demo story', () => {
  it('registers the service worker only in live mode with service worker support', () => {
    expect(shouldRegisterPwa('live', true)).toBe(true);
    expect(shouldRegisterPwa('mock', true)).toBe(false);
    expect(shouldRegisterPwa(undefined, true)).toBe(false);
    expect(shouldRegisterPwa('live', false)).toBe(false);
  });

  it('builds the realtime URL for mock and live backends', () => {
    expect(realtimeUrl('t1', true, '')).toMatch(/^ws:\/\/localhost(:\d+)?\/api\/v1\/ws$/);
    expect(realtimeUrl('a b', false, 'https://api.example.org')).toBe(
      'wss://api.example.org/api/v1/console/ws?token=a%20b',
    );
  });

  it('discards session changes and returns to the known demo state', async () => {
    await signInBackendOnly('mission_control');
    mockState.missionDayOverride = 60;
    await simulationApi.createRun({ run_name: 'Scratch', speed_multiplier: 10 });
    expect(await simulationApi.listRuns()).toHaveLength(2);

    const state = await simulationApi.demoStory();
    expect(state).toMatchObject({ mission_day: 25, mission_time: '2027-03-25T12:00:00Z' });
    expect(await simulationApi.listRuns()).toHaveLength(1);
    const audit = await missionsApi.auditLog();
    expect(audit.items.map((a) => a.action_type)).toEqual(['demo_story']);
  });
});
