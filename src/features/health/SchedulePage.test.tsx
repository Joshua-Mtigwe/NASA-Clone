import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

describe('My Schedule', () => {
  it('lists each item with start, duration, priority, workload and status, and labels drafts', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/schedule');

    await waitFor(() =>
      expect(screen.getByTestId('schedule-date')).toHaveTextContent('25 Mar 2027'),
    );
    const items = await screen.findAllByTestId('schedule-item');
    expect(items.length).toBeGreaterThan(3);

    const task = items.find((i) => within(i).queryByText('Task'))!;
    for (const field of ['Start', 'Duration', 'Priority', 'Workload category', 'Status']) {
      expect(within(task).getByText(field)).toBeInTheDocument();
    }
    expect(within(task).getByText(/^\d{2}:\d{2}–\d{2}:\d{2} UTC$/)).toBeInTheDocument();
    // task_assignments.csv rows are demo_unapproved.
    expect(within(task).getByText('Draft, not approved')).toBeInTheDocument();

    const kinds = items.map((i) => i.querySelector('p')?.textContent);
    expect(kinds).toEqual(
      expect.arrayContaining(['Task', 'Assessment', 'Supportive routine', 'Exercise', 'Sleep']),
    );
    expect(screen.getByText(/Meals and breaks are not yet provided/)).toBeInTheDocument();
  });

  it('moves to the next day and back', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/schedule');

    await screen.findAllByTestId('schedule-item');
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByTestId('schedule-date')).toHaveTextContent('26 Mar 2027');
    expect(screen.getByTestId('schedule-date')).not.toHaveTextContent('Today');
    await waitFor(() => expect(screen.getAllByTestId('schedule-item').length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByTestId('schedule-date')).toHaveTextContent('25 Mar 2027Today');
  });
});
