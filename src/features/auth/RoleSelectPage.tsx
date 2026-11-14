import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ChartScatter,
  HeartPulse,
  Loader2,
  Orbit,
  Rocket,
  ShieldAlert,
  X,
  type LucideProps,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { Navigate, useLocation } from 'react-router';
import { authApi } from '@/api/auth';
import type { DemoAccount, LoginResponse } from '@/api/types';
import { isPathAllowed } from '@/app/navigation';
import { queryKeys } from '@/app/queryClient';
import { ROLE_HOME, ROLE_LABELS, type DashboardRole } from '@/app/roles';
import { DataState, MockApiBadge, Starfield } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { isDemoMode } from '@/config/env';
import { cn } from '@/lib/utils';
import type { RedirectState } from './guards';
import { useSession } from './sessionStore';

/** Astronaut helmet with a visor reflection (no suitable icon exists in lucide). */
function HelmetIcon(props: LucideProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 14a8 8 0 1 1 16 0v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M7 12.5a5 5 0 0 1 10 0v.5a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 7 13z" />
      <path d="M9.5 11a2.5 2.5 0 0 1 2-1.5" />
      <path d="M8 20v1.5M16 20v1.5" />
    </svg>
  );
}

interface RoleCard {
  role: DashboardRole;
  icon: ComponentType<LucideProps>;
  description: string;
  /** Tailwind classes for the icon halo; one hue per role. */
  tone: string;
}

const CARDS: RoleCard[] = [
  {
    role: 'astronaut',
    icon: HelmetIcon,
    description:
      'Your readiness estimate, vitals, body map, Mission Mind games, schedule and the Mind Companion.',
    tone: 'from-cyan-400/30 to-sky-600/10 text-cyan-200',
  },
  {
    role: 'mission_leader',
    icon: Orbit,
    description:
      'Crew availability, task pool, schedule generation and approval, and supportive-routine publishing.',
    tone: 'from-sky-400/30 to-indigo-600/10 text-sky-200',
  },
  {
    role: 'medical_researcher',
    icon: ChartScatter,
    description:
      'Exploratory analyses, preflight and inflight cognition comparison, planning impact and reports.',
    tone: 'from-violet-400/30 to-indigo-600/10 text-violet-200',
  },
  {
    role: 'medical_officer',
    icon: HeartPulse,
    description:
      'Assessment completion oversight, programme building, access grants and flagged results.',
    tone: 'from-teal-400/30 to-emerald-600/10 text-teal-200',
  },
];

function destination(role: DashboardRole, from: string | undefined): string {
  return from && isPathAllowed(role, from) ? from : ROLE_HOME[role];
}

/**
 * Demonstration-mode landing page: pick a role (and, for the astronaut role, which
 * astronaut) to open that dashboard. There is no password; this is not secure
 * authentication and the page says so.
 */
export function RoleSelectPage({ demoMode = isDemoMode }: { demoMode?: boolean }) {
  const session = useSession();
  const location = useLocation();
  const from = (location.state as RedirectState | null)?.from;
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    document.title = 'Choose a role · AEGIS';
  }, []);

  const roster = useQuery({
    queryKey: queryKeys.demoAccounts,
    queryFn: () => authApi.demoAccounts(),
    enabled: demoMode,
  });

  const open = useMutation<LoginResponse, Error, string>({
    mutationFn: (username) => authApi.demoSession({ username }),
    onSuccess: (response) => session.setSession(response, 'demo'),
  });

  if (session.token && session.role) {
    return <Navigate to={destination(session.role, from)} replace />;
  }

  const accounts = roster.data ?? [];
  const astronauts = accounts.filter((a) => a.role === 'astronaut' && a.astronaut_id);
  const accountFor = (role: DashboardRole) => accounts.find((a) => a.role === role);

  const choose = (role: DashboardRole) => {
    if (role === 'astronaut') {
      setPicking(true);
      return;
    }
    const account = accountFor(role);
    if (account) open.mutate(account.username);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-950">
      <div className="nebula pointer-events-none absolute inset-0" aria-hidden="true" />
      <Starfield />
      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-4 py-10 sm:py-16">
        <header className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/40 bg-accent-muted/30 shadow-[0_0_24px_rgba(34,195,221,0.35)]">
            <Rocket className="h-5 w-5 text-accent" aria-hidden="true" />
          </span>
          <span className="text-title tracking-[0.3em] text-accent-strong">AEGIS</span>
          <MockApiBadge className="ml-auto" />
        </header>

        <section className="max-w-3xl space-y-4 motion-safe:animate-fade-up">
          <p className="text-label uppercase tracking-[0.25em] text-ink-subtle">
            Autonomous Edge-Guided Intelligent Supervisor
          </p>
          <h1 className="text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            Crew health, cognition and mission planning,{' '}
            <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 bg-clip-text text-transparent">
              onboard and offline-first.
            </span>
          </h1>
          <p className="text-body text-ink-muted">Choose a role to open its dashboard.</p>
        </section>

        {session.endedReason && (
          <p
            role="status"
            className="rounded-md border border-status-review/40 bg-status-review-bg px-4 py-3 text-ink"
          >
            {session.endedReason}
          </p>
        )}

        {!demoMode ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-status-review/40 bg-status-review-bg p-4 text-ink"
          >
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-status-review"
              aria-hidden="true"
            />
            Demonstration role selection is disabled in this deployment. Sign-in must go through the
            deployment&apos;s authentication service.
          </p>
        ) : (
          <DataState
            status={roster.isPending ? 'loading' : roster.isError ? 'error' : 'ready'}
            error={roster.error}
            onRetry={() => void roster.refetch()}
            loadingMessage="Loading roles…"
          >
            <ul
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Roles"
              data-testid="role-cards"
            >
              {CARDS.map((card, i) => {
                const Icon = card.icon;
                const available =
                  card.role === 'astronaut' ? astronauts.length > 0 : !!accountFor(card.role);
                return (
                  <li
                    key={card.role}
                    className="motion-safe:animate-fade-up"
                    style={{ animationDelay: `${120 + i * 80}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => choose(card.role)}
                      disabled={!available || open.isPending}
                      className="role-card group flex h-full w-full flex-col gap-4 rounded-2xl border border-white/10 bg-navy-900/60 p-6 text-left backdrop-blur-md transition duration-300 hover:-translate-y-1 hover:border-accent/60 hover:bg-navy-850/80 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:hover:translate-y-0"
                    >
                      <span
                        className={cn(
                          'flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ring-1 ring-white/10 transition duration-300 group-hover:scale-105 motion-reduce:group-hover:scale-100',
                          card.tone,
                        )}
                      >
                        <Icon className="h-7 w-7" aria-hidden="true" />
                      </span>
                      <span className="text-title text-ink">{ROLE_LABELS[card.role]}</span>
                      <span className="flex-1 text-sm text-ink-muted">{card.description}</span>
                      <span className="inline-flex items-center gap-1.5 text-label font-medium text-accent-strong">
                        {card.role === 'astronaut' ? 'Choose astronaut' : 'Open dashboard'}
                        <ArrowRight
                          className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:group-hover:translate-x-0"
                          aria-hidden="true"
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </DataState>
        )}

        {picking && (
          <AstronautPicker
            astronauts={astronauts}
            pending={open.isPending}
            onPick={(a) => open.mutate(a.username)}
            onClose={() => setPicking(false)}
          />
        )}

        {open.isError && (
          <p role="alert" className="text-sm text-status-action">
            {open.error.message}
          </p>
        )}

        <p className="mt-auto max-w-3xl text-caption text-ink-subtle">
          Demonstration mode: dashboards open without a password and show synthetic demonstration
          data only. This is not secure authentication, and nothing entered here is confidential.
        </p>
      </main>
    </div>
  );
}

function AstronautPicker({
  astronauts,
  pending,
  onPick,
  onClose,
}: {
  astronauts: DemoAccount[];
  pending: boolean;
  onPick: (account: DemoAccount) => void;
  onClose: () => void;
}) {
  return (
    <section
      aria-labelledby="picker-title"
      className="rounded-2xl border border-accent/30 bg-navy-900/80 p-5 backdrop-blur-md motion-safe:animate-fade-up"
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 id="picker-title" className="text-title">
          Which astronaut are you?
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={onClose}
          aria-label="Close"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        The dashboard shows only the selected astronaut&apos;s records and Mind Companion
        conversations.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {astronauts.map((a) => (
          <li key={a.username}>
            <button
              type="button"
              onClick={() => onPick(a)}
              disabled={pending}
              className="flex w-full flex-col gap-1 rounded-xl border border-white/10 bg-navy-850/70 p-4 text-left transition hover:border-accent/60 hover:bg-navy-800 disabled:opacity-60"
            >
              <span className="font-mono text-label text-accent-strong">{a.astronaut_code}</span>
              <span className="text-sm text-ink">{a.crew_role ?? 'Crew member'}</span>
              <span className="text-caption text-ink-subtle">{a.specialization ?? ''}</span>
            </button>
          </li>
        ))}
      </ul>
      {pending && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening dashboard…
        </p>
      )}
    </section>
  );
}
