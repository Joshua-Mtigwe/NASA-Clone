import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp, setupMockApi } from '@/test/appHarness';
import { SESSION_STORAGE_KEY, useSession } from './sessionStore';

setupMockApi();

describe('Login', () => {
  it('signs in with a demo card, stores the session and lands on the role home', async () => {
    const { router } = renderApp('/login');

    const cards = await screen.findByRole('region', { name: 'Demo accounts' });
    const buttons = await within(cards).findAllByRole('button');
    expect(buttons.map((b) => b.querySelector('span')?.textContent)).toEqual([
      'Astronaut',
      'Mission Planning Leader',
      'Medical Researcher',
      'Medical Officer',
      'Mission Control Administrator',
    ]);

    await userEvent.click(within(cards).getByRole('button', { name: /^Astronaut/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/astronaut');
    expect(useSession.getState()).toMatchObject({
      role: 'astronaut',
      astronautId: 'AST-001',
      token: expect.any(String) as unknown,
    });
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!).state.role).toBe('astronaut');
  });

  it('shows the backend error and stays on the login page when the password is wrong', async () => {
    const { router } = renderApp('/login');

    await userEvent.type(screen.getByLabelText('Username'), 'crew1');
    await userEvent.type(screen.getByLabelText('Password'), 'not-the-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.');
    expect(router.state.location.pathname).toBe('/login');
    expect(useSession.getState().token).toBeNull();
  });

  it('returns to the page originally requested when the role is allowed to see it', async () => {
    const { router } = renderApp('/planner/tasks');
    expect(
      await screen.findByRole('heading', { name: 'AEGIS Mission Console' }),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Username'), 'mission_leader');
    await userEvent.type(screen.getByLabelText('Password'), 'demo');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/planner/tasks'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Task Pool' })).toBeInTheDocument();
  });
});
