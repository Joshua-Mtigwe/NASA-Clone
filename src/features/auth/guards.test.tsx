import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { navItems } from '@/app/navigation';
import { ROLE_HOME, type DashboardRole } from '@/app/roles';
import { renderApp, signInAs, setupMockApi } from '@/test/appHarness';
import { useSession } from './sessionStore';

setupMockApi();

/** For each role: a page it owns and a page that belongs to another role. */
const CASES: Array<[DashboardRole, string, string]> = [
  ['astronaut', '/astronaut/health/trends', '/planner/tasks'],
  ['mission_leader', '/planner/schedule', '/astronaut/cognition/trends'],
  ['medical_researcher', '/research/analyses', '/medical/access'],
  ['medical_officer', '/medical/programmes', '/research/reports'],
];

describe('RequireRole', () => {
  it.each(CASES)('%s opens %s but gets the 403 page for %s', async (role, own, other) => {
    await signInAs(role);

    const first = renderApp(own);
    const label = navItems(role).find((i) => i.path === own)!.label;
    expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
    first.unmount();

    const { router } = renderApp(other);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access restricted' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/403');
    expect(screen.getByRole('link', { name: 'Go to my home page' })).toHaveAttribute(
      'href',
      ROLE_HOME[role],
    );
  });

  it('sends signed-out users to login, and ends the session when the backend rejects the token', async () => {
    const signedOut = renderApp('/astronaut');
    await waitFor(() => expect(signedOut.router.state.location.pathname).toBe('/login'));
    signedOut.unmount();

    useSession.setState({
      token: 'mock-token.USR-DOES-NOT-EXIST',
      role: 'astronaut',
      astronautId: 'AST-001',
      user: {
        user_id: 'X',
        username: 'ghost',
        role_id: 'ROLE-1',
        role: 'astronaut',
        astronaut_id: 'AST-001',
      },
    });
    const { router } = renderApp('/astronaut');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByText('Not authenticated.')).toBeInTheDocument();
    expect(useSession.getState().token).toBeNull();
  });
});
