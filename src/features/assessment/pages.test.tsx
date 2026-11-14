import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { assessmentsApi } from '@/api/assessments';
import { astronautsApi } from '@/api/astronauts';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';
import { localDb } from './offline/db';

setupMockApi();
beforeEach(async () => {
  mockState.missionDayOverride = 25;
  await localDb.outbox.clear();
  await localDb.completions.clear();
});

describe('Preflight area', () => {
  it('enables Start only when the backend authorises the session and its conditions are met', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/preflight');

    const rows = await screen.findAllByTestId('due-session');
    expect(rows).toHaveLength(8);
    const row = (name: string) => rows.find((r) => within(r).queryByRole('heading', { name }))!;

    const pvt = row('Signal Response');
    expect(within(pvt).getByTestId('condition-tag')).toHaveTextContent('Morning');
    expect(within(pvt).getByText('Ready')).toBeInTheDocument();
    expect(within(pvt).getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/astronaut\/preflight\//),
    );

    const rotation = row('Navigation Challenge');
    expect(within(rotation).getByTestId('condition-tag')).toHaveTextContent('Night');
    expect(within(rotation).getByText('Conditions not met')).toBeInTheDocument();
    expect(within(rotation).getByText('Available 20:00–05:00 UTC.')).toBeInTheDocument();
    expect(within(rotation).getByRole('button', { name: 'Start' })).toBeDisabled();

    const reasoning = row('Logical Reasoning');
    expect(within(reasoning).getByText('Waiting for access')).toBeInTheDocument();
    expect(within(reasoning).getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(within(row('Command Switch')).getByTestId('condition-tag')).toHaveTextContent(
      'After physical work',
    );
  });
});

describe('Mission Mind hub', () => {
  it("shows today's status, the backend time estimate and the streak", async () => {
    await signInAs('astronaut');
    const summary = await assessmentsApi.missionMindSummary('AST-001');
    renderApp('/astronaut/mission-mind');

    expect(await screen.findByTestId('session-status')).toHaveTextContent('0 of 3 complete');
    const minutes = Math.round(summary.estimate_seconds / 60);
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(minutes).toBeLessThanOrEqual(8);
    expect(screen.getByTestId('estimate')).toHaveTextContent(`About ${minutes} min`);
    expect(summary.streak_days).toBeGreaterThan(0);
    expect(screen.getByTestId('streak')).toHaveTextContent(`${summary.streak_days} days in a row`);
  });

  it('lists the five games with per-game progress and opens today’s games', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/mission-mind');

    const cards = await screen.findAllByTestId('game-card');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Signal Response',
      'Memory Matrix',
      'System Scanner',
      'Navigation Challenge',
      'Command Switch',
    ]);
    const today = cards.filter((c) => within(c).queryByText('Today'));
    expect(today.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Signal Response',
      'Command Switch',
    ]);
    expect(within(cards[1]!).getByText('Not scheduled today')).toBeInTheDocument();
    expect(cards[0]).toHaveTextContent(/\d+ sessions completed/);

    await userEvent.click(within(today[0]!).getByRole('link', { name: 'Play' }));
    expect(
      await screen.findByRole('region', { name: 'Signal Response session' }),
    ).toBeInTheDocument();
  });

  it('summarises completed games by domain, each in its own unit', async () => {
    await signInAs('astronaut');
    const due = await assessmentsApi.due('AST-001');
    const game = due.find(
      (d) => d.mission_phase === 'inflight' && d.protocol.protocol_id === 'PVT',
    )!;
    const session = await assessmentsApi.startSession({
      assignment_id: game.assignment.assignment_id,
    });
    await assessmentsApi.submitTrials(session.session_id, {
      phase: 'test',
      input_device: 'keyboard',
      test_version: 'pvt-v1',
      trials: [280, 300, 320].map((rt, i) => ({
        trial_number: i + 1,
        stimulus_type: 'visual_signal',
        stimulus_value: 'target',
        expected_response: 'click',
        actual_response: 'click',
        reaction_time_ms: rt,
        is_correct: 1,
        is_lapse: 0,
        is_false_start: 0,
        trial_timestamp: '2027-03-25T12:00:00Z',
      })),
    });
    await assessmentsApi.completeSession(session.session_id, {
      completed_at: '2027-03-25T12:02:00Z',
    });
    renderApp('/astronaut/mission-mind');

    const summary = await screen.findByTestId('domain-summary');
    expect(summary).toHaveTextContent('Vigilance');
    expect(summary).toHaveTextContent('Median reaction time: 300 ms');
    expect(screen.getByTestId('session-status')).toHaveTextContent('1 of 3 complete');
    expect(screen.getByText(/There is no combined score/)).toBeInTheDocument();
  });
});

describe('Baseline profile', () => {
  it('shows the reference for each domain by condition', async () => {
    await signInAs('astronaut');
    const baselines = await astronautsApi.baselines('AST-001');
    renderApp('/astronaut/baseline');

    const rows = await screen.findAllByTestId('baseline-row');
    expect(rows).toHaveLength(baselines.length);
    for (const name of ['Vigilance', 'Attention', 'Working memory']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    const vigilance = screen.getByRole('region', { name: 'Vigilance' });
    expect(within(vigilance).getByText('Morning')).toBeInTheDocument();
    expect(within(vigilance).getByText('Evening')).toBeInTheDocument();
  });

  it('shows valid observations, variability and the baseline version for each row', async () => {
    await signInAs('astronaut');
    const baselines = await astronautsApi.baselines('AST-001');
    renderApp('/astronaut/baseline');

    const b = baselines.find(
      (x) => x.cognitive_domain === 'vigilance' && x.assessment_condition === 'morning',
    )!;
    await waitFor(() => expect(screen.getAllByTestId('baseline-row').length).toBeGreaterThan(0));
    const row = screen
      .getAllByTestId('baseline-row')
      .find((r) => r.textContent?.includes(`n = ${b.sample_size}`))!;
    expect(row).toHaveTextContent(`± ${b.standard_deviation}`);
    expect(row).toHaveTextContent(b.baseline_version);
    expect(row).toHaveTextContent(/–/);
  });
});
