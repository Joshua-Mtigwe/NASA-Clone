import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { astronautsApi } from '@/api/astronauts';
import { planningApi } from '@/api/planning';
import { mockState } from '@/mocks/db';
import { renderApp, setupMockApi, signInAs } from '@/test/appHarness';

setupMockApi();
beforeEach(() => {
  mockState.missionDayOverride = 25;
});

const DATE = '2027-03-25';

async function openSchedule() {
  await signInAs('mission_leader');
  renderApp('/planner/schedule');
  await screen.findByTestId('schedule-timeline');
  await waitFor(() => expect(screen.getAllByTestId('task-bar').length).toBeGreaterThan(0));
}

describe('Planner Overview', () => {
  it('shows the backend totals for the day', async () => {
    await signInAs('mission_leader');
    const o = await planningApi.overview(DATE);
    renderApp('/planner');
    expect(await screen.findByTestId('kpi-crew')).toHaveTextContent(String(o.crew_members));
    expect(screen.getByTestId('kpi-tasks')).toHaveTextContent(String(o.tasks_submitted));
    expect(screen.getByTestId('kpi-pending')).toHaveTextContent(String(o.pending_review));
    expect(screen.getByTestId('kpi-scheduled')).toHaveTextContent(/\d+ h \d+ min|\d+ min/);
  });

  it('lists crew operational status without any cognitive scores', async () => {
    await signInAs('mission_leader');
    const { container } = renderApp('/planner');
    const rows = await screen.findAllByTestId('crew-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Flight Engineer');
    expect(within(rows[0]!).getByText('Unverified demonstration data')).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText(/Assessment current|Review pending|No current assessment/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/reaction time|accuracy| ms\b|working memory score/i);
  });
});

describe('Task Pool', () => {
  it('lists the day’s tasks and filters by category', async () => {
    await signInAs('mission_leader');
    const set = await planningApi.getTaskSet('SET-025');
    renderApp('/planner/tasks');
    const cards = await screen.findAllByTestId('task-card');
    expect(cards).toHaveLength(set.tasks.length);

    const category = set.tasks[0]!.task.task_category;
    await userEvent.selectOptions(screen.getByLabelText('Category'), category);
    const filtered = screen.getAllByTestId('task-card');
    expect(filtered).toHaveLength(
      set.tasks.filter((t) => t.task.task_category === category).length,
    );
  });

  it('shows a five-part demand profile labelled as an unvalidated AI proposal', async () => {
    await signInAs('mission_leader');
    renderApp('/planner/tasks');
    const profile = (await screen.findAllByTestId('demand-profile'))[0]!;
    expect(within(profile).getByText('Proposed by AI, not validated')).toBeInTheDocument();
    const bars = within(profile).getAllByRole('img');
    expect(bars.map((b) => b.getAttribute('aria-label')?.split(':')[0])).toEqual([
      'Sustained attention',
      'Working memory',
      'Physical effort',
      'Time pressure',
      'Procedural complexity',
    ]);
    expect(bars[1]).toHaveAccessibleName('Working memory: No data');
    expect(bars[0]).toHaveAccessibleName(/Sustained attention: \d of 5/);
  });

  it('rejects a task without a title, then creates one with every field', async () => {
    await signInAs('mission_leader');
    renderApp('/planner/tasks');
    await screen.findAllByTestId('task-card');
    await userEvent.click(screen.getByRole('button', { name: /New task/ }));
    const form = await screen.findByRole('form', { name: 'New task' });
    await userEvent.click(within(form).getByRole('button', { name: 'Create task' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Title is required');

    await userEvent.type(within(form).getByLabelText('Title'), 'Filter replacement');
    await userEvent.selectOptions(within(form).getByLabelText('Category'), 'maintenance');
    await userEvent.selectOptions(
      within(form).getByLabelText('Safety classification'),
      'safety_critical',
    );
    await userEvent.type(within(form).getByLabelText('Equipment and location'), 'Node 2 rack');
    await userEvent.click(within(form).getByLabelText('Fixed time'));
    await userEvent.clear(within(form).getByLabelText('Working memory (0–5)'));
    await userEvent.type(within(form).getByLabelText('Working memory (0–5)'), '3');
    await userEvent.click(within(form).getByRole('button', { name: 'Create task' }));

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New task' })).not.toBeInTheDocument(),
    );
    const card = (await screen.findAllByTestId('task-card')).find((c) =>
      c.textContent?.includes('Filter replacement'),
    )!;
    expect(card).toHaveTextContent('Safety-critical');
    expect(card).toHaveTextContent('fixed');
    expect(within(card).getByText('Edited by the mission leader')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Working memory: 3 of 5' })).toBeInTheDocument();
  });

  it('edits an existing task', async () => {
    await signInAs('mission_leader');
    renderApp('/planner/tasks');
    const first = (await screen.findAllByTestId('task-card'))[0]!;
    await userEvent.click(within(first).getByRole('button', { name: /^Edit/ }));
    const form = await screen.findByRole('form', { name: 'Edit task' });
    const title = within(form).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed check');
    await userEvent.click(within(form).getByRole('button', { name: 'Save task' }));
    expect(await screen.findByText('Renamed check')).toBeInTheDocument();
  });
});

describe('Crew Schedule', () => {
  it('generates a plan through the pipeline stages and selects the new alternative', async () => {
    await openSchedule();
    await userEvent.click(screen.getByRole('button', { name: /Generate plan/ }));
    const region = await screen.findByRole('region', { name: 'Plan generation' });
    expect(within(region).getAllByTestId('pipeline-stage')).toHaveLength(4);
    await waitFor(
      () =>
        expect(
          within(region)
            .getAllByTestId('pipeline-stage')
            .every((s) => s.dataset.status === 'completed'),
        ).toBe(true),
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Schedule version')).toHaveDisplayValue(
        /Version 2 \(alternative\)/,
      ),
    );
  });

  it('shows every crew member with precise times, and filters by astronaut', async () => {
    await openSchedule();
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(5);
    expect(screen.getAllByTestId('task-bar')[0]).toHaveAccessibleName(
      /, \d{2}:\d{2}–\d{2}:\d{2} UTC$/,
    );
    await userEvent.selectOptions(screen.getByLabelText('Astronaut'), 'AST-002');
    expect(screen.getAllByTestId('timeline-row')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'AST-002 timeline' })).toBeInTheDocument();
  });

  it('lists conflicts, missing qualifications and unassigned tasks with reasons', async () => {
    await signInAs('mission_leader');
    await planningApi.listSchedules({ task_set_id: 'SET-025' });
    const detail = await planningApi.getSchedule('SV-SET-025-1');
    await openSchedule();
    const issues = await screen.findByTestId('issues');
    expect(within(issues).getAllByRole('listitem')).toHaveLength(detail.issues.length);
    expect(issues).toHaveTextContent(detail.issues[0]!.reason);
  });

  it('labels the scheduler explanation beside the selected recommendation', async () => {
    await openSchedule();
    await userEvent.click(screen.getAllByTestId('task-bar')[0]!);
    const panel = screen.getByRole('region', { name: 'Selected assignment' });
    expect(within(panel).getByText('Assignment explanation')).toBeInTheDocument();
    expect(panel).toHaveTextContent('NOT a validated health allocation');
  });

  it('lets the leader switch between alternative schedules', async () => {
    await signInAs('mission_leader');
    await planningApi.listSchedules({ task_set_id: 'SET-025' });
    const run = await planningApi.optimize({ task_set_id: 'SET-025' });
    for (let i = 0; i < 4; i += 1) await planningApi.optimizeStatus(run.optimization_run_id!);
    await openSchedule();

    const select = screen.getByLabelText('Schedule version');
    expect(within(select).getAllByRole('option')).toHaveLength(2);
    const before = screen.getByRole('group', { name: 'AST-001 timeline' }).textContent;
    await userEvent.selectOptions(select, 'SV-SET-025-2');
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'AST-001 timeline' }).textContent).not.toBe(before),
    );
  });

  it('requires a reason before a manual override is applied', async () => {
    await openSchedule();
    await userEvent.click(screen.getAllByTestId('task-bar')[0]!);
    const form = screen.getByRole('form', { name: 'Manual override' });
    const apply = within(form).getByRole('button', { name: 'Apply override' });
    expect(apply).toBeDisabled();

    const start = within(form).getByLabelText('Start (UTC)');
    await userEvent.clear(start);
    await userEvent.type(start, '07:15');
    await userEvent.type(within(form).getByLabelText(/Reason for override/), 'Crew request');
    await userEvent.click(apply);
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('task-bar')
          .some((b) => /07:15–/.test(b.getAttribute('aria-label') ?? '')),
      ).toBe(true),
    );
  });

  it('compares scheduled time with each astronaut’s duty limit', async () => {
    await openSchedule();
    const rows = await screen.findAllByTestId('duty-row');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(/AST-001.*(Within limit|Over limit)/);
    expect(rows[0]).toHaveTextContent(/8 h 0 min/);
  });

  it('shows sleep, exercise, assessments and routines as locked blocks', async () => {
    await openSchedule();
    await waitFor(() => expect(screen.getAllByTestId('locked-block').length).toBeGreaterThan(0));
    expect(
      screen
        .getAllByTestId('locked-block')
        .some((b) => /Exercise|Assessment|Recovery/.test(b.textContent ?? '')),
    ).toBe(true);
  });

  it('labels the plan as a draft until approved, and requires each safety-critical confirmation', async () => {
    await signInAs('mission_leader');
    await planningApi.listSchedules({ task_set_id: 'SET-025' });
    const detail = await planningApi.getSchedule('SV-SET-025-1');
    const critical = detail.assignments[0]!.task_id;
    await planningApi.updateRequirements(critical, { safety_classification: 'safety_critical' });
    await openSchedule();

    expect(screen.getByText('Draft, not approved')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Approve and publish' });
    const approve = within(region).getByRole('button', { name: 'Approve and publish' });
    expect(approve).toBeDisabled();
    await userEvent.click(within(region).getByRole('checkbox'));
    await userEvent.click(approve);
    expect(await screen.findByText('Approved and published')).toBeInTheDocument();
    expect(screen.queryByText('Draft, not approved')).not.toBeInTheDocument();
  });

  it('publishes the approved plan to the astronaut’s My Schedule', async () => {
    await signInAs('mission_leader');
    await planningApi.listSchedules({ task_set_id: 'SET-025' });
    const run = await planningApi.optimize({ task_set_id: 'SET-025' });
    for (let i = 0; i < 4; i += 1) await planningApi.optimizeStatus(run.optimization_run_id!);
    const v2 = await planningApi.getSchedule('SV-SET-025-2');
    await expect(
      planningApi.approveSchedule('SV-SET-025-2', { confirmed_safety_critical: [] }),
    ).resolves.toMatchObject({ status: 'approved' });

    await signInAs('astronaut');
    const mine = v2.assignments
      .filter((a) => a.astronaut_id === 'AST-001')
      .map((a) => a.task_assignment_id)
      .sort();
    const schedule = await astronautsApi.schedule('AST-001', DATE);
    const tasks = schedule.items.filter((i) => i.kind === 'task');
    expect(tasks.map((t) => t.ref_id).sort()).toEqual(mine);
    expect(tasks.every((t) => t.approval_status === 'approved')).toBe(true);
  });
});

describe('Recovery Planning', () => {
  it('ranks supportive routines for an astronaut and shows the catalogue', async () => {
    await signInAs('mission_leader');
    renderApp('/planner/recovery');
    expect(await screen.findAllByTestId('catalogue-item')).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Get recommendations' }));
    const list = await screen.findByTestId('recommendations');
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(list).toHaveTextContent('#1');
    expect(document.body.textContent).not.toMatch(/treatment|therapy/i);
  });
});
