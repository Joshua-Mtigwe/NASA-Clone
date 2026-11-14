import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LoginResponse, SessionUser } from '@/api/types';
import { isDashboardRole, type DashboardRole } from '@/app/roles';

/**
 * `demo`: opened from the public role selector (demonstration mode, no password, not
 * secure authentication). `authenticated`: a credential sign-in through the backend
 * (kept so proper authentication can be restored).
 */
export type SessionMode = 'demo' | 'authenticated';

export interface SessionState {
  token: string | null;
  user: SessionUser | null;
  role: DashboardRole | null;
  astronautId: string | null;
  mode: SessionMode | null;
  /** Set when the backend ended the session (401), so the landing page can say why. */
  endedReason: string | null;
  setSession: (response: LoginResponse, mode?: SessionMode) => void;
  clear: (reason?: string) => void;
}

export const SESSION_STORAGE_KEY = 'aegis-session';

const empty = { token: null, user: null, role: null, astronautId: null, mode: null };

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      ...empty,
      endedReason: null,
      setSession: ({ access_token, user }, mode = 'authenticated') => {
        // A role without a dashboard (the backend-only administrator) cannot sign in here.
        if (!isDashboardRole(user.role)) {
          set({ ...empty, endedReason: 'This role has no dashboard in this application.' });
          return;
        }
        set({
          token: access_token,
          user,
          role: user.role,
          astronautId: user.astronaut_id,
          mode,
          endedReason: null,
        });
      },
      clear: (reason) => set({ ...empty, endedReason: reason ?? null }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ token, user, role, astronautId, mode }) => ({
        token,
        user,
        role,
        astronautId,
        mode,
      }),
      // Drop a stored session for a role that no longer has a dashboard.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionState>;
        return isDashboardRole(p.role) ? { ...current, ...p } : current;
      },
    },
  ),
);
