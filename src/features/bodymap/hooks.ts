import { useQuery } from '@tanstack/react-query';
import { radiationApi } from '@/api/radiation';
import { vitalsApi } from '@/api/vitals';

export function useOrganDose(astronautId: string | null, to: string | null) {
  return useQuery({
    queryKey: ['radiation', astronautId, 'organ-dose', to],
    queryFn: () => radiationApi.organDose({ astronaut_id: astronautId!, to: to! }),
    enabled: !!astronautId && !!to,
  });
}

export function useSensors() {
  return useQuery({
    queryKey: ['vitals', 'sensors'],
    queryFn: () => vitalsApi.sensors(),
    staleTime: 10 * 60_000,
  });
}
