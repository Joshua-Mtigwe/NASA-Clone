import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ROLE_HOME, type DashboardRole } from '@/app/roles';
import { renderApp, signInAs, setupMockApi } from '@/test/appHarness';

setupMockApi();

/** Top-level menu entries per role; groups are buttons, pages are links. */
const EXPECTED: Record<DashboardRole, string[]> = {
  astronaut: [
    'Overview',
    'Health Monitoring',
    'Cognitive Metrics',
    'My Schedule',
    'Recovery & Sleep',
  ],
  mission_leader: [
    'Planner Overview',
    'Task Pool',
    'Crew Schedule',
    'Recovery Planning',
    'Planning Effectiveness',
  ],
  medical_researcher: [
    'Research Overview',
    'Analyses',
    'Cognition Comparison',
    'Planning Effectiveness',
    'Reports',
  ],
  medical_officer: ['Oversight', 'Assessment Programmes', 'Access Grants', 'Crew Assessments'],
};

describe('role menus', () => {
  it.each(Object.keys(EXPECTED) as DashboardRole[])('shows exactly the %s menu', async (role) => {
    await signInAs(role);
    renderApp(ROLE_HOME[role]);

    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const entries = within(nav)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement?.parentElement === nav)
      .map((li) => li.firstElementChild!.textContent);
    expect(entries).toEqual(EXPECTED[role]);
    expect(within(nav).getByRole('link', { name: EXPECTED[role][0] })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('expands and collapses the astronaut groups and keeps the parent active for a child page', async () => {
    await signInAs('astronaut');
    const { router } = renderApp('/astronaut/health/vitals');
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });

    const health = within(nav).getByRole('button', { name: 'Health Monitoring' });
    expect(health).toHaveAttribute('aria-expanded', 'true');
    expect(health).toHaveAttribute('data-active', 'true');
    expect(within(nav).getByRole('link', { name: 'Current Vitals' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const cognition = within(nav).getByRole('button', { name: 'Cognitive Metrics' });
    expect(cognition).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(cognition);
    expect(cognition).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(nav).getByRole('link', { name: 'Cognitive Trends' }));
    expect(router.state.location.pathname).toBe('/astronaut/cognition/trends');
    expect(within(nav).queryByRole('link', { name: 'Alerts' })).not.toBeInTheDocument();
  });

  it('redirects earlier astronaut paths', async () => {
    await signInAs('astronaut');
    const { router } = renderApp('/astronaut/mission-mind');
    await screen.findByRole('heading', { level: 1, name: 'Mission Mind' });
    expect(router.state.location.pathname).toBe('/astronaut/cognition/mission-mind');
  });
});
