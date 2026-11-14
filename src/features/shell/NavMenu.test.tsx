import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Role } from '@/api/types';
import { ROLE_HOME } from '@/app/roles';
import { renderApp, signInAs, setupMockApi } from '@/test/appHarness';

setupMockApi();

// Exactly the menus listed in BUILD_PLAN.md Phase 1, item 5.
const EXPECTED: Record<Role, string[]> = {
  astronaut: [
    'Overview',
    'Health Monitoring',
    'Body Map',
    'Mission Mind',
    'Cognitive Trends',
    'My Schedule',
    'Recovery and Sleep',
    'Alerts',
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
  mission_control_admin: [
    'Mission State',
    'Simulation',
    'Events',
    'Data Integrity',
    'AI Status',
    'Audit',
  ],
};

describe('role menus', () => {
  it.each(Object.keys(EXPECTED) as Role[])('shows exactly the %s menu', async (role) => {
    await signInAs(role);
    renderApp(ROLE_HOME[role]);

    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(EXPECTED[role]);
    // The home item is marked as the current page.
    expect(within(nav).getByRole('link', { name: EXPECTED[role][0] })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
