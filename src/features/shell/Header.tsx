import { CalendarDays, Clock, LogOut, Menu, PlayCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Role } from '@/api/types';
import { ROLE_LABELS } from '@/app/roles';
import { MockApiBadge, SyntheticBadge } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { formatTimestamp, humanise } from '@/lib/format';
import { ActiveAstronaut } from './ActiveAstronaut';
import { ConnectionIndicator } from './ConnectionIndicator';
import { useConnectionStatus } from './useConnectionStatus';
import { useMissionState } from './useMissionState';

interface HeaderProps {
  role: Role;
  username: string;
  astronautId: string | null;
  onOpenMenu: () => void;
  onLogout: () => void;
}

function Item({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />
      <span className="text-caption uppercase text-ink-subtle">{label}</span>
      <span className="text-label text-ink">{children}</span>
    </div>
  );
}

export function Header({ role, username, astronautId, onOpenMenu, onLogout }: HeaderProps) {
  const mission = useMissionState();
  const connection = useConnectionStatus();
  const state = mission.data;
  const run = state?.simulation_run;

  return (
    <header
      className="sticky top-0 z-30 border-b bg-surface-raised/95 backdrop-blur"
      aria-label="Mission status"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-2 lg:hidden"
          onClick={onOpenMenu}
          aria-label="Open menu"
        >
          <Menu aria-hidden="true" />
        </Button>

        {mission.isPending ? (
          <span className="text-label text-ink-muted" role="status">
            Loading mission state…
          </span>
        ) : mission.isError && !state ? (
          <span className="text-label text-status-action" role="alert">
            Mission state unavailable
          </span>
        ) : state ? (
          <>
            <Item icon={CalendarDays} label="Mission day">
              <span data-testid="mission-day">
                Day {state.mission_day} / {state.mission_length_days}
              </span>
            </Item>
            <Item icon={Clock} label="Mission clock">
              <time dateTime={state.mission_time} data-testid="mission-clock">
                {formatTimestamp(state.mission_time)}
              </time>
            </Item>
            <Item icon={PlayCircle} label="Simulation">
              <span data-testid="simulation-run">
                {run ? `${run.run_name} · ${humanise(run.status)}` : 'No simulation run'}
              </span>
            </Item>
          </>
        ) : null}

        <ConnectionIndicator status={connection} />
        <ActiveAstronaut role={role} astronautId={astronautId} />

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <SyntheticBadge dataMode={state?.data_mode} isSynthetic={state?.is_synthetic} />
          <MockApiBadge />
          <span className="text-label text-ink-muted">
            <span className="text-ink">{username}</span> · {ROLE_LABELS[role]}
          </span>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
