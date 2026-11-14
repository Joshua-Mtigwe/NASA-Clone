import { useMutation, useQuery } from '@tanstack/react-query';
import { LogIn, Rocket } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { authApi } from '@/api/auth';
import type { DemoAccount, LoginRequest, LoginResponse, Role } from '@/api/types';
import { isPathAllowed } from '@/app/navigation';
import { queryKeys } from '@/app/queryClient';
import { ROLE_HOME, ROLE_LABELS, ROLES } from '@/app/roles';
import { DataState, MockApiBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { isMockMode } from '@/config/env';
import { MOCK_DEMO_PASSWORD } from './demo';
import type { RedirectState } from './guards';
import { useSession } from './sessionStore';

/** One demo account per role, in menu order. */
function demoCards(accounts: DemoAccount[]): DemoAccount[] {
  return ROLES.flatMap((role) => {
    const account = accounts.find((a) => a.role === role);
    return account ? [account] : [];
  });
}

function destination(role: Role, from: string | undefined): string {
  return from && isPathAllowed(role, from) ? from : ROLE_HOME[role];
}

export function LoginPage({ mockMode = isMockMode }: { mockMode?: boolean }) {
  const session = useSession();
  const location = useLocation();
  const from = (location.state as RedirectState | null)?.from;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const usernameId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    document.title = 'Sign in · AEGIS';
  }, []);

  const login = useMutation<LoginResponse, Error, LoginRequest>({
    mutationFn: (body) => authApi.login(body),
    // Storing the session re-renders this page, whose redirect below navigates.
    onSuccess: (response) => session.setSession(response),
  });

  const demo = useQuery({
    queryKey: queryKeys.demoAccounts,
    queryFn: () => authApi.demoAccounts(),
    enabled: mockMode,
  });

  if (session.token && session.role) {
    // Also runs right after a successful login, so it must honour `from` too.
    return <Navigate to={destination(session.role, from)} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username: username.trim(), password });
  };

  const signInAs = (account: DemoAccount) => {
    setUsername(account.username);
    setPassword(MOCK_DEMO_PASSWORD);
    login.mutate({ username: account.username, password: MOCK_DEMO_PASSWORD });
  };

  const cards = demo.data ? demoCards(demo.data) : [];

  return (
    <div className="min-h-screen bg-surface-sunken px-4 py-10">
      <main className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="flex flex-wrap items-center gap-3">
          <Rocket className="h-7 w-7 text-accent" aria-hidden="true" />
          <h1 className="text-display">AEGIS Mission Console</h1>
          <MockApiBadge className="ml-auto" />
        </div>

        {session.endedReason && (
          <p
            role="status"
            className="rounded-md border border-status-review/40 bg-status-review-bg px-4 py-3 text-ink"
          >
            {session.endedReason}
          </p>
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
          <Card className="p-6">
            <h2 className="mb-4 text-title">Sign in</h2>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor={usernameId} className="text-label text-ink-muted">
                  Username
                </label>
                <Input
                  id={usernameId}
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  aria-describedby={login.isError ? errorId : undefined}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={passwordId} className="text-label text-ink-muted">
                  Password
                </label>
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-describedby={login.isError ? errorId : undefined}
                />
              </div>
              {login.isError && (
                <p id={errorId} role="alert" className="text-sm text-status-action">
                  {login.error.message}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={login.isPending}>
                <LogIn aria-hidden="true" />
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </Card>

          {mockMode && (
            <section aria-labelledby="demo-heading" className="space-y-3">
              <h2 id="demo-heading" className="text-title">
                Demo accounts
              </h2>
              <p className="text-sm text-ink-muted">
                Mock mode only. Each card signs in with the seeded account for that role.
              </p>
              <DataState
                status={
                  demo.isPending
                    ? 'loading'
                    : demo.isError
                      ? 'error'
                      : cards.length
                        ? 'ready'
                        : 'empty'
                }
                error={demo.error}
                onRetry={() => void demo.refetch()}
                emptyMessage="No demo accounts are seeded."
              >
                <ul className="grid gap-3 sm:grid-cols-2">
                  {cards.map((account) => (
                    <li key={account.username}>
                      <button
                        type="button"
                        onClick={() => signInAs(account)}
                        disabled={login.isPending}
                        className="flex h-full w-full flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left shadow-console transition-colors hover:border-accent/60 hover:bg-navy-800 disabled:opacity-60"
                      >
                        <span className="font-medium text-ink">{ROLE_LABELS[account.role]}</span>
                        <span className="text-caption text-ink-subtle">
                          {account.username} · {account.role_description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </DataState>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
