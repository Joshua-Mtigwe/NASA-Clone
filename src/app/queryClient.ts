import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Do not retry permission or validation errors; retry transient ones once.
        retry: (failureCount, error) => {
          if (
            isApiError(error) &&
            ['unauthorized', 'forbidden', 'not_found', 'validation'].includes(error.kind)
          ) {
            return false;
          }
          return failureCount < 1;
        },
      },
    },
  });
}

export const queryKeys = {
  missionState: ['missions', 'current', 'state'] as const,
  me: ['auth', 'me'] as const,
  demoAccounts: ['auth', 'demo-accounts'] as const,
  astronauts: ['astronauts'] as const,
};
