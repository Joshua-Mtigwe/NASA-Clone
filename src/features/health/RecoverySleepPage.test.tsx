import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

describe('Recovery and Sleep', () => {
  it('lists scheduled supportive routines from the catalogue, worded as routines', async () => {
    await signInAs('astronaut');
    const { container } = renderApp('/astronaut/recovery');

    const routines = await screen.findAllByTestId('routine');
    expect(routines.length).toBeGreaterThan(0);
    const names = [
      'Guided paced breathing',
      'Quiet break',
      'Light mobility',
      'Sleep preparation',
      'Mindfulness break',
      'Scheduled exercise',
    ];
    for (const r of routines) {
      expect(names.some((n) => within(r).queryByText(n))).toBe(true);
      expect(r).toHaveTextContent(/\d{2}:\d{2}–\d{2}:\d{2} UTC/);
    }
    expect(
      screen.getByRole('heading', { name: 'Supportive routines (next 7 days)' }),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/treat|therap|cure/i);
  });

  it('shows recent measured sleep and an honest empty state for protection windows', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/recovery');

    const nights = await screen.findAllByTestId('sleep-night');
    expect(nights.length).toBe(7);
    expect(nights[0]).toHaveTextContent(/\d+ h \d+ min asleep/);
    expect(within(nights[0]!).getByText('Measured')).toBeInTheDocument();
    expect(screen.getByText(/No sleep protection windows are scheduled/)).toBeInTheDocument();
  });
});
