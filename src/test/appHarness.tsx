/**
 * Renders the real route tree against the MSW mock API, for app-level tests.
 * Call setupMockApi() once at the top of a test file.
 */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { authApi } from '@/api/auth';
import type { DashboardRole } from '@/app/roles';
import { Providers } from '@/app/Providers';
import { createQueryClient } from '@/app/queryClient';
import { appRoutes } from '@/app/routes';
import { bindApiClient } from '@/features/auth/bindApiClient';
import { MOCK_DEMO_PASSWORD } from '@/features/auth/demo';
import { useSession } from '@/features/auth/sessionStore';
import { useUi } from '@/features/shell/uiStore';
import { resetMockDb } from '@/mocks/db';
import { server } from '@/mocks/server';

/** One demo account per dashboard role (users.csv). */
export const DEMO_USER: Record<DashboardRole, string> = {
  astronaut: 'crew1',
  mission_leader: 'mission_leader',
  medical_researcher: 'researcher',
  medical_officer: 'medical_officer',
};

export function setupMockApi(): void {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
    bindApiClient();
  });
  beforeEach(() => {
    resetMockDb();
    localStorage.clear();
    useSession.getState().clear();
    useUi.setState({ selectedAstronautId: null, mobileNavOpen: false });
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}

export async function signInAs(role: DashboardRole): Promise<void> {
  const response = await authApi.login({ username: DEMO_USER[role], password: MOCK_DEMO_PASSWORD });
  useSession.getState().setSession(response);
}

/**
 * Backend-only roles (the administrator) have no dashboard, so the session store
 * refuses them; API-level tests still need their token.
 */
export async function signInBackendOnly(username: string): Promise<void> {
  const response = await authApi.login({ username, password: MOCK_DEMO_PASSWORD });
  useSession.setState({ token: response.access_token });
}

export function renderApp(path: string) {
  const client = createQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const utils = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router, client };
}
