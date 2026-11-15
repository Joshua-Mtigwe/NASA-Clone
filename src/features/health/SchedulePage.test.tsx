import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { recoveryApi } from '@/api/recovery';
import type { ScheduleItem } from '@/api/types';
import { mockState, resetMockDb } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';
import { layoutDay } from './scheduleLayout';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

const item = (ref_id: string, start: string, end: string): ScheduleItem => ({
  kind: 'task',
  ref_id,
  title: 't',
  start_time: `2027-03-25T${start}:00Z`,
  end_time: `2027-03-25T${end}:00Z`,
  duration_minutes: null,
  priority: null,
  workload_category: null,
  completion_status: null,
  approval_status: null,
});

describe('My Schedule', () => {
  it('shows the day as a timetable with details on demand and day navigation', async () => {
    await signInAs('astronaut');
    renderApp('/astronaut/schedule');

    await waitFor(() =>
      expect(screen.getByTestId('schedule-date')).toHaveTextContent('25 Mar 2027'),
    );
    const items = await screen.findAllByTestId('schedule-item');
    const kinds = new Set(items.map((i) => i.getAttribute('data-kind')));
    expect([...kinds]).toEqual(expect.arrayContaining(['task', 'assessment', 'exercise', 'sleep']));
    // The CSV routine for today is an unpublished draft, so it is not on the timetable.
    expect(kinds.has('recovery')).toBe(false);
    expect(await screen.findByText(/has not published a supportive routine/)).toBeInTheDocument();

    await userEvent.click(items.find((i) => i.getAttribute('data-kind') === 'task')!);
    const dialog = await screen.findByRole('dialog');
    for (const field of ['Time', 'Duration', 'Priority', 'Workload category', 'Status']) {
      expect(within(dialog).getByText(field)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Draft, not approved')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByTestId('schedule-date')).toHaveTextContent('26 Mar 2027');
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByTestId('schedule-date')).toHaveTextContent('25 Mar 2027');
  });

  it('places overlapping activities side by side', () => {
    const placed = layoutDay(
      [item('a', '09:00', '10:00'), item('b', '09:30', '10:30'), item('c', '11:00', '11:30')],
      '2027-03-25',
    );
    const byId = Object.fromEntries(placed.map((p) => [p.item.ref_id, p]));
    expect(byId.a).toMatchObject({ start: 540, end: 600, column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ column: 1, columns: 2 });
    expect(byId.c).toMatchObject({ column: 0, columns: 1 });
  });
});

describe('supportive routine publishing', () => {
  it('lets the leader publish directly; the astronaut sees it once, and it survives a reload', async () => {
    await signInAs('mission_leader');
    const [rec] = await recoveryApi.recommend({ astronaut_id: 'AST-001', mission_day: 25 });
    const check = await recoveryApi.publish(rec!.recommendation_id, { dry_run: true });
    expect(check.reasons).toEqual([]);
    expect(check.conflicts).toEqual([]);
    expect(check.state).toBe('ready_to_publish');

    const published = await recoveryApi.publish(rec!.recommendation_id, {});
    expect(published).toMatchObject({ state: 'published', already_published: false });
    const again = await recoveryApi.publish(rec!.recommendation_id, {});
    expect(again).toMatchObject({ state: 'published', already_published: true });

    // A page reload restarts the in-memory mock; the publication is kept.
    resetMockDb();
    mockState.missionDayOverride = 25;
    await signInAs('astronaut');
    const list = await recoveryApi.published({ astronaut_id: 'AST-001', date: '2027-03-25' });
    expect(list).toHaveLength(1);
    expect(list[0]!.recommendation_id).toBe(rec!.recommendation_id);

    renderApp('/astronaut/schedule');
    expect(await screen.findByTestId('published-routine')).toHaveTextContent(
      list[0]!.activity!.activity_name,
    );
    const items = await screen.findAllByTestId('schedule-item');
    expect(items.filter((i) => i.getAttribute('data-kind') === 'recovery')).toHaveLength(1);
  });

  it('refuses astronauts, past mission days and slots that overlap committed activities', async () => {
    await signInAs('astronaut');
    await expect(recoveryApi.publish('RCR-AST-001-025', {})).rejects.toMatchObject({
      status: 403,
    });
    await signInAs('mission_leader');
    const past = await recoveryApi.publish('RCR-AST-001-010', { dry_run: true });
    expect(past.state).toBe('unable_to_schedule');
    expect(past.reasons.join(' ')).toMatch(/already passed/);

    const day = await recoveryApi.publish('RCR-AST-001-026', { dry_run: true });
    expect(day.state).toBe('ready_to_publish');
    const sleep = await recoveryApi.publish('RCR-AST-001-026', {
      scheduled_start: '2027-03-26T23:30:00Z',
      dry_run: true,
    });
    expect(sleep.state).toBe('unable_to_schedule');
    await expect(
      recoveryApi.publish('RCR-AST-001-010', { scheduled_start: '2027-03-10T16:00:00Z' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
