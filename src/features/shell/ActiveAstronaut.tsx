import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { astronautsApi } from '@/api/astronauts';
import type { Role } from '@/api/types';
import { queryKeys } from '@/app/queryClient';
import { CAN_SELECT_ASTRONAUT } from '@/app/roles';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUi } from './uiStore';

/**
 * Astronauts see themselves. Medical roles choose whose data they are viewing.
 * Planning and control roles work across the whole crew.
 */
export function ActiveAstronaut({ role, astronautId }: { role: Role; astronautId: string | null }) {
  const selected = useUi((s) => s.selectedAstronautId);
  const select = useUi((s) => s.selectAstronaut);
  const canSelect = CAN_SELECT_ASTRONAUT.includes(role);
  const crew = useQuery({
    queryKey: queryKeys.astronauts,
    queryFn: () => astronautsApi.list(),
    enabled: canSelect,
  });

  const label = <span className="text-caption uppercase text-ink-subtle">Active astronaut</span>;

  if (role === 'astronaut') {
    return (
      <div className="flex items-center gap-2" data-testid="active-astronaut">
        <UserRound className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        {label}
        <span className="text-label text-ink">{astronautId ?? 'Not linked'}</span>
      </div>
    );
  }

  if (!canSelect) {
    return (
      <div className="flex items-center gap-2" data-testid="active-astronaut">
        <UserRound className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        {label}
        <span className="text-label text-ink">All crew</span>
      </div>
    );
  }

  const astronauts = crew.data ?? [];
  const value = selected ?? astronauts[0]?.astronaut_id;

  return (
    <div className="flex items-center gap-2" data-testid="active-astronaut">
      <UserRound className="h-4 w-4 text-ink-muted" aria-hidden="true" />
      {label}
      {crew.isError ? (
        <span className="text-label text-status-action">Crew list unavailable</span>
      ) : (
        <Select value={value ?? ''} onValueChange={select} disabled={!astronauts.length}>
          <SelectTrigger className="h-8 w-36" aria-label="Active astronaut">
            <SelectValue placeholder={crew.isPending ? 'Loading…' : 'Select'} />
          </SelectTrigger>
          <SelectContent>
            {astronauts.map((a) => (
              <SelectItem key={a.astronaut_id} value={a.astronaut_id}>
                {a.astronaut_code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
