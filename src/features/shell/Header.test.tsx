import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '@/mocks/server';
import { renderApp, signInAs, setupMockApi } from '@/test/appHarness';
import { useSession } from '@/features/auth/sessionStore';

setupMockApi();

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

afterEach(() => setOnline(true));

describe('header', () => {
  it('shows mission day, clock, simulation run, astronaut and badges, unchanged across navigation', async () => {
    const stateRequests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/missions/current/state')) stateRequests.push(request.url);
    });

    await signInAs('astronaut');
    const { router } = renderApp('/astronaut');
    const header = await screen.findByRole('banner', { name: 'Mission status' });

    expect(await within(header).findByTestId('mission-day')).toHaveTextContent('Day 1 / 90');
    expect(within(header).getByTestId('mission-clock')).toHaveTextContent('01 Mar 2027, 00:00 UTC');
    expect(within(header).getByTestId('simulation-run')).toHaveTextContent(
      'Default 90-day demo · Paused',
    );
    expect(within(header).getByTestId('active-astronaut')).toHaveTextContent('AST-001');
    expect(within(header).getByText('Synthetic demonstration data')).toBeInTheDocument();
    expect(within(header).getByText('Mock API')).toBeInTheDocument();
    await waitFor(
      () =>
        expect(
          within(header).getByRole('status', { name: 'Connection: Synced' }),
        ).toBeInTheDocument(),
      // Pages behind the shell load large fixtures; under a parallel run that takes > 1 s.
      { timeout: 5000 },
    );

    await userEvent.click(screen.getByRole('link', { name: 'Alerts' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/astronaut/alerts');
    expect(screen.getByRole('banner', { name: 'Mission status' })).toBe(header);
    expect(within(header).getByTestId('mission-day')).toHaveTextContent('Day 1 / 90');
    expect(stateRequests).toHaveLength(1);

    server.events.removeAllListeners();
  });

  it('switches to Offline when the browser loses its connection, and signs out cleanly', async () => {
    await signInAs('medical_officer');
    const { router } = renderApp('/medical');
    const header = await screen.findByRole('banner', { name: 'Mission status' });
    await waitFor(
      () =>
        expect(
          within(header).getByRole('status', { name: 'Connection: Synced' }),
        ).toBeInTheDocument(),
      // Pages behind the shell load large fixtures; under a parallel run that takes > 1 s.
      { timeout: 5000 },
    );

    setOnline(false);
    expect(within(header).getByRole('status', { name: 'Connection: Offline' })).toBeInTheDocument();
    setOnline(true);
    expect(
      within(header).queryByRole('status', { name: 'Connection: Offline' }),
    ).not.toBeInTheDocument();

    await userEvent.click(within(header).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(useSession.getState().token).toBeNull();
  });
});
