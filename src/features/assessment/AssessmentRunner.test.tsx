import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessmentsApi } from '@/api/assessments';
import type { DueAssessment } from '@/api/types';
import { Providers } from '@/app/Providers';
import { createQueryClient } from '@/app/queryClient';
import { mockState } from '@/mocks/db';
import { server } from '@/mocks/server';
import { setupMockApi, signInAs } from '@/test/appHarness';
import { createManualClock } from '@/test/manualClock';
import { AssessmentRunner } from './AssessmentRunner';
import { PVT } from './battery/core';
import { buildSchedule } from './battery/registry';
import { localDb } from './offline/db';

const caps = vi.hoisted(() => ({ webgl: false }));
vi.mock('@/features/bodymap/capabilities', () => ({
  hasWebGL: () => caps.webgl,
  prefersReducedMotion: () => false,
}));
vi.mock('./PixiStage', () => ({ default: () => <div data-testid="pixi-stage" /> }));

setupMockApi();
beforeEach(async () => {
  mockState.missionDayOverride = 25;
  caps.webgl = false;
  await localDb.outbox.clear();
  await localDb.completions.clear();
});

// Mock ids restart for each test, so the first session is always MOCK-SES-0001.
const SESSION = 'MOCK-SES-0001';
const COUNTS = { practice: 1, test: 2 };

async function dueFor(protocol: string, phase = 'preflight'): Promise<DueAssessment> {
  await signInAs('astronaut');
  const due = await assessmentsApi.due('AST-001');
  return due.find((d) => d.protocol.protocol_id === protocol && d.mission_phase === phase)!;
}

function renderRunner(due: DueAssessment, theme: 'standard' | 'mission' = 'standard') {
  const m = createManualClock();
  render(
    <Providers client={createQueryClient()}>
      <AssessmentRunner due={due} theme={theme} deps={m} trialCounts={COUNTS} />
    </Providers>,
  );
  return m;
}

function schedule(due: DueAssessment, phase: 'practice' | 'test') {
  return buildSchedule(PVT, `${due.assignment.assignment_id}|${SESSION}`, phase, COUNTS[phase]);
}

/** Wait the exact foreperiod, then respond `rt` ms after onset with the keyboard. */
function playPvt(m: ReturnType<typeof createManualClock>, foreperiod: number, rt: number) {
  act(() => m.advance(foreperiod));
  expect(screen.getByTestId('pvt-signal')).toBeInTheDocument();
  act(() => m.advance(rt));
  fireEvent.keyDown(window, { key: ' ' });
}

describe('assessment session flow', () => {
  it('runs instructions, practice, test and shows the backend score with no overall grade', async () => {
    const due = await dueFor('PVT');
    const m = renderRunner(due);

    const region = screen.getByRole('region', { name: 'Psychomotor Vigilance Test session' });
    expect(within(region).getByText('Morning')).toBeInTheDocument();
    expect(within(region).getByText(/Respond as fast as you can/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }));

    await screen.findByText(/Practice · trial 1 of 1/);
    playPvt(m, schedule(due, 'practice')[0]!.foreperiodMs, 280);
    await userEvent.click(await screen.findByRole('button', { name: 'Start test' }));

    const test = schedule(due, 'test');
    playPvt(m, test[0]!.foreperiodMs, 300);
    playPvt(m, test[1]!.foreperiodMs, 400);

    const done = await screen.findByTestId('completion');
    await waitFor(() => expect(done).toHaveTextContent('Median reaction time'));
    expect(done).toHaveTextContent('350 ms');
    expect(done).not.toHaveTextContent(/overall|grade|total score/i);
    // Practice trials were stored apart and never scored.
    expect(mockState.practiceTrials.get(SESSION)).toHaveLength(1);
  });

  it('pauses when focus is lost, repeats the trial on resume, and reports the interruption', async () => {
    const due = await dueFor('PVT');
    const m = renderRunner(due);
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    await screen.findByText(/Practice · trial 1/);
    playPvt(m, schedule(due, 'practice')[0]!.foreperiodMs, 250);
    await userEvent.click(await screen.findByRole('button', { name: 'Start test' }));

    const test = schedule(due, 'test');
    act(() => m.advance(test[0]!.foreperiodMs));
    act(() => {
      fireEvent.blur(window);
    });
    const paused = screen.getByRole('alertdialog', { name: 'Paused' });
    expect(paused).toHaveTextContent('The interrupted trial will be repeated');
    await userEvent.click(within(paused).getByRole('button', { name: 'Resume' }));
    expect(screen.getByText(/Test · trial 1 of 2/)).toBeInTheDocument();

    playPvt(m, test[0]!.foreperiodMs, 310);
    playPvt(m, test[1]!.foreperiodMs, 330);
    const done = await screen.findByTestId('completion');
    await waitFor(() => expect(done).toHaveTextContent('valid with interruptions'));
  });

  it('keeps the completion on the device when the server is unreachable', async () => {
    const due = await dueFor('PVT');
    server.use(http.post('*/api/v1/assessments/sessions/:id/complete', () => HttpResponse.error()));
    const m = renderRunner(due);
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    await screen.findByText(/Practice · trial 1/);
    playPvt(m, schedule(due, 'practice')[0]!.foreperiodMs, 250);
    await userEvent.click(await screen.findByRole('button', { name: 'Start test' }));
    const test = schedule(due, 'test');
    playPvt(m, test[0]!.foreperiodMs, 300);
    playPvt(m, test[1]!.foreperiodMs, 300);

    const done = await screen.findByTestId('completion');
    await waitFor(() => expect(done).toHaveTextContent(/Saved on this device/));
    expect(await localDb.outbox.count()).toBe(1);
  });

  it('shows the backend refusal when a session is not authorised', async () => {
    const due = await dueFor('REASONING');
    expect(due.authorized).toBe(false);
    renderRunner(due);
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This assessment session is not authorised yet.',
    );
  });

  it('records the subjective check-in and shows the fatigue score the backend returns', async () => {
    const due = await dueFor('SURVEY');
    renderRunner(due);
    await userEvent.click(screen.getByRole('button', { name: 'Start check-in' }));

    const form = await screen.findByRole('form', { name: 'Subjective state check-in' });
    for (const [question, n] of [
      ['How fatigued do you feel?', 6],
      ['How sleepy do you feel?', 4],
      ['How demanding has your workload been?', 5],
      ['How well did you sleep last night?', 7],
    ] as const) {
      await userEvent.click(within(form).getByLabelText(`${question} ${n}`));
    }
    await userEvent.click(within(form).getByRole('button', { name: 'Submit check-in' }));

    const done = await screen.findByTestId('completion');
    await waitFor(() => expect(done).toHaveTextContent('Fatigue score'));
    expect(done).toHaveTextContent('6 on a 1–9 scale');
  });
});

describe('Mission Mind theme', () => {
  it('uses the same schedule and timing as the preflight test, in the mission skin', async () => {
    const due = await dueFor('PVT', 'inflight');
    const m = renderRunner(due, 'mission');
    expect(screen.getByRole('region', { name: 'Signal Response session' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    await screen.findByText(/Practice · trial 1/);
    expect(screen.getByText('Signal Response · console')).toBeInTheDocument();

    // Onset happens exactly at the foreperiod from the theme-independent schedule.
    const fp = schedule(due, 'practice')[0]!.foreperiodMs;
    act(() => m.advance(fp - 1));
    expect(screen.queryByTestId('pvt-signal')).not.toBeInTheDocument();
    act(() => m.advance(1));
    expect(screen.getByTestId('pvt-signal')).toBeInTheDocument();
  });

  it('renders the game with PixiJS when WebGL is available', async () => {
    caps.webgl = true;
    const due = await dueFor('PVT', 'inflight');
    renderRunner(due, 'mission');
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(await screen.findByTestId('pixi-stage')).toBeInTheDocument();
  });
});
