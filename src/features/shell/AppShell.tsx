import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';
import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { authApi } from '@/api/auth';
import { queryKeys } from '@/app/queryClient';
import { ROLE_LABELS } from '@/app/roles';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useSession } from '@/features/auth/sessionStore';
import { useLogout } from '@/features/auth/useLogout';
import { startQueueSync } from '@/features/assessment/offline/queue';
import { RealtimeBridge } from '@/features/realtime/RealtimeBridge';
import { DataState } from '@/components/shared';
import { Header } from './Header';
import { NavMenu } from './NavMenu';
import { useUi } from './uiStore';

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3 py-4">
      <Rocket className="h-5 w-5 text-accent" aria-hidden="true" />
      <span className="text-title tracking-wide text-accent">AEGIS</span>
    </div>
  );
}

/**
 * Persistent layout for every signed-in page. The header and its mission state stay
 * mounted across navigation; only the <Outlet /> changes.
 */
export function AppShell() {
  const { role, user, astronautId } = useSession();
  const queryClient = useQueryClient();
  const mobileOpen = useUi((s) => s.mobileNavOpen);
  const setMobileOpen = useUi((s) => s.setMobileNavOpen);
  const logout = useLogout();
  const { pathname } = useLocation();

  // Validates a persisted token; a 401 here ends the session via the API client.
  useQuery({ queryKey: queryKeys.me, queryFn: () => authApi.me(), staleTime: 5 * 60_000 });

  // Send queued assessment data now, on reconnect, and every 30 s.
  useEffect(
    () =>
      startQueueSync(30_000, () => {
        void queryClient.invalidateQueries();
      }),
    [queryClient],
  );

  if (!role || !user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-foreground"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-gradient-to-b from-navy-850 via-navy-900 to-navy-950 lg:flex">
        <Brand />
        <p className="px-3 pb-3 text-caption uppercase text-ink-subtle">{ROLE_LABELS[role]}</p>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <NavMenu role={role} />
        </div>
      </aside>

      <RealtimeBridge />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-2">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">{ROLE_LABELS[role]} pages</SheetDescription>
          <Brand />
          <NavMenu role={role} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-col">
        <Header
          role={role}
          username={user.username}
          astronautId={astronautId}
          onOpenMenu={() => setMobileOpen(true)}
          onLogout={() => void logout()}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 lg:px-6">
          <Suspense fallback={<DataState status="loading" loadingMessage="Loading page…" />}>
            {/* Keyed by path so each page fades in once on navigation. */}
            <div key={pathname} className="motion-safe:animate-fade-in">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
