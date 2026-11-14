import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LoginResponse, Role, SessionUser } from '@/api/types';

export interface SessionState {
  token: string | null;
  user: SessionUser | null;
  role: Role | null;
  astronautId: string | null;
  /** Set when the backend ended the session (401), so the login page can say why. */
  endedReason: string | null;
  setSession: (response: LoginResponse) => void;
  clear: (reason?: string) => void;
}

export const SESSION_STORAGE_KEY = 'aegis-session';

const empty = { token: null, user: null, role: null, astronautId: null };

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      ...empty,
      endedReason: null,
      setSession: ({ access_token, user }) =>
        set({
          token: access_token,
          user,
          role: user.role,
          astronautId: user.astronaut_id,
          endedReason: null,
        }),
      clear: (reason) => set({ ...empty, endedReason: reason ?? null }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ token, user, role, astronautId }) => ({ token, user, role, astronautId }),
    },
  ),
);
