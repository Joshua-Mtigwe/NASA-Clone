import { useQuery } from '@tanstack/react-query';
import { astronautsApi } from '@/api/astronauts';
import { queryKeys } from '@/app/queryClient';
import { useSession } from '@/features/auth/sessionStore';
import { useUi } from './uiStore';

/**
 * Whose data a page shows: astronauts always see themselves; other roles use the
 * astronaut chosen in the header (default: the first crew member).
 */
export function useActiveAstronaut(): string | null {
  const role = useSession((s) => s.role);
  const own = useSession((s) => s.astronautId);
  const selected = useUi((s) => s.selectedAstronautId);
  const crew = useQuery({
    queryKey: queryKeys.astronauts,
    queryFn: () => astronautsApi.list(),
    enabled: role !== 'astronaut' && !selected,
  });
  if (role === 'astronaut') return own;
  return selected ?? crew.data?.[0]?.astronaut_id ?? null;
}
