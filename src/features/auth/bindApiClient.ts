import { configureApiClient } from '@/api/client';
import { useSession } from './sessionStore';

/**
 * Connect the API client to the session: send the token, and end the session on
 * a 401. A 403 is handled where it happens (DataState shows "Access restricted").
 */
export function bindApiClient(): void {
  configureApiClient({
    getToken: () => useSession.getState().token,
    onUnauthorized: (error) => {
      // A failed login is also a 401; only end a session that exists.
      if (useSession.getState().token) useSession.getState().clear(error.message);
    },
  });
}
