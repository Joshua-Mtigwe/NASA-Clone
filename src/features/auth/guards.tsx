import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ROLE_HOME, type DashboardRole } from '@/app/roles';
import { useSession } from './sessionStore';

export interface RedirectState {
  from?: string;
}

/** Sends signed-out users to /login, remembering where they were going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  const location = useLocation();
  if (!token) {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname } satisfies RedirectState} />
    );
  }
  return <>{children}</>;
}

/** Shows the 403 page when the session's role is not in `roles`. */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly DashboardRole[];
  children: ReactNode;
}) {
  const role = useSession((s) => s.role);
  const location = useLocation();
  if (!role || !roles.includes(role)) {
    return (
      <Navigate to="/403" replace state={{ from: location.pathname } satisfies RedirectState} />
    );
  }
  return <>{children}</>;
}

/** `/` goes to the signed-in role's home page. */
export function RoleHomeRedirect() {
  const role = useSession((s) => s.role);
  return <Navigate to={role ? ROLE_HOME[role] : '/login'} replace />;
}
