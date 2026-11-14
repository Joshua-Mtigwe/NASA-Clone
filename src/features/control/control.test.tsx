import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { missionsApi } from '@/api/missions';
import { simulationApi } from '@/api/simulation';
import { localDb } from '@/features/assessment/offline/db';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
let realNow = 1_000_000;
beforeEach(async () => {
  mockState.missionDayOverride = 25;
  realNow = 1_000_000;
  mockState.clockNow = () => realNow;
  await localDb.outbox.clear();
});

describe('Mission Control', () => {
  it('starts, advances at the playback speed, and pauses the simulation clock', async () => {
    await signInAs('mission_control_admin');
    renderApp('/control/simulation');
    const run = await screen
      .findByRole('group', { name: /Default 90-day demo/ })
      .catch(() => screen.findAllByTestId('run-row').then((r) => r[0]!));
    await userEvent.click(within(run).getByRole('button', { name: /Start/ }));
    await waitFor(() =>
      expect(within(screen.getAllByTestId('run-row')[0]!).getByText('Running')).toBeInTheDocument(),
    );

    realNow += 60_000; // one real minute at x60 = one mission hour
    expect((await missionsApi.currentState()).mission_time).toBe('2027-03-25T13:00:00Z');
    await userEvent.click(
      within(screen.getAllByTestId('run-row')[0]!).getByRole('button', { name: /Pause/ }),
    );
    await waitFor(() =>
      expect(within(screen.getAllByTestId('run-row')[0]!).getByText('Paused')).toBeInTheDocument(),
    );
    realNow += 60_000;
    expect((await missionsApi.currentState()).mission_time).toBe('2027-03-25T13:00:00Z');
  });

  it('changes playback speed and selects another run', async () => {
    await signInAs('mission_control_admin');
    await simulationApi.createRun({ run_name: 'Rehearsal', speed_multiplier: 60 });
    renderApp('/control/simulation');
    const rows = await screen.findAllByTestId('run-row');
    const speed = within(rows[0]!).getByLabelText(/Playback speed/);
    await userEvent.clear(speed);
    await userEvent.type(speed, '120');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Apply speed' }));
    await waitFor(async () =>
      expect((await simulationApi.listRuns())[0]!.speed_multiplier).toBe(120),
    );

    const rehearsal = screen
      .getAllByTestId('run-row')
      .find((r) => r.textContent?.includes('Rehearsal'))!;
    await userEvent.click(within(rehearsal).getByRole('button', { name: 'Select' }));
    await waitFor(async () =>
      expect((await missionsApi.currentState()).simulation_run?.run_name).toBe('Rehearsal'),
    );
  });

  it('triggers a predefined event and records it in the audit log', async () => {
    await signInAs('mission_control_admin');
    renderApp('/control/events');
    const events = await screen.findAllByTestId('event-row');
    expect(events.length).toBeGreaterThan(10);
    await userEvent.click(within(events[0]!).getByRole('button', { name: /Trigger/ }));
    expect(await screen.findByTestId('triggered-event')).toHaveTextContent('day 25');
    const audit = await missionsApi.auditLog();
    expect(audit.items[0]).toMatchObject({ action_type: 'trigger_event' });
  });

  it('shows data lineage, the sync queue on this device and on the server, and the audit log', async () => {
    await signInAs('mission_control_admin');
    await localDb.outbox.add({
      kind: 'complete',
      sessionId: 'S1',
      payload: { completed_at: 'x' },
      createdAt: 'x',
      attempts: 0,
      status: 'pending',
      lastError: null,
    });
    const { unmount } = renderApp('/control/integrity');
    expect(await screen.findAllByTestId('lineage-row')).toHaveLength(49);
    // The shell flushes the queue at once; this unknown session is rejected and marked failed.
    await waitFor(() =>
      expect(screen.getByTestId('local-queue')).toHaveTextContent(
        /1 item\(s\) waiting · 0 failed|0 item\(s\) waiting · 1 failed/,
      ),
    );
    expect(screen.getByText('No sync events have been recorded yet.')).toBeInTheDocument();
    unmount();

    await simulationApi.startRun('RUN-DEMO-001');
    renderApp('/control/audit');
    const rows = await screen.findAllByTestId('audit-row');
    expect(rows[0]).toHaveTextContent('Start run');
  });

  it('reports AI status honestly when nothing has been logged, and resets the demo story', async () => {
    await signInAs('mission_control_admin');
    const { unmount } = renderApp('/control/ai');
    expect(await screen.findByTestId('ai-loaded')).toHaveTextContent('No data');
    expect(screen.getByTestId('ai-latency')).toHaveTextContent('No data');
    expect(screen.getByText(/No inference has been logged yet/)).toBeInTheDocument();
    unmount();

    mockState.missionDayOverride = 40;
    renderApp('/control');
    expect(await screen.findByTestId('state-day')).toHaveTextContent('Day 40 / 90');
    await userEvent.click(screen.getByRole('button', { name: 'Start demo story' }));
    expect(await screen.findByText(/Demo story ready: Day 25 \/ 90/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('state-day')).toHaveTextContent('Day 25 / 90'));
  });
});
