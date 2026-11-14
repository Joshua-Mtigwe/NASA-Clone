import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { RealtimeMessage } from '@/api/types';
import { queryKeys } from '@/app/queryClient';
import { useSession } from '@/features/auth/sessionStore';
import { useUi } from '@/features/shell/uiStore';
import { createRealtimeClient } from './client';
import { realtimeUrl } from './url';

/**
 * Keeps the mission state, alerts and simulation views live: messages write straight
 * into the query cache, so the header and open dashboards update without a reload.
 */
export function RealtimeBridge({
  enabled = import.meta.env.MODE !== 'test',
}: {
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const token = useSession((s) => s.token);
  const setStatus = useUi((s) => s.setRealtimeStatus);

  useEffect(() => {
    if (!enabled || !token) return;
    const onMessage = (m: RealtimeMessage) => {
      if (m.type === 'mission_state' || m.type === 'simulation_tick') {
        queryClient.setQueryData(queryKeys.missionState, m.payload);
      } else if (m.type === 'alert') {
        void queryClient.invalidateQueries({
          queryKey: ['astronauts', m.payload.astronaut_id, 'alerts'],
        });
      } else if (m.type === 'event_triggered') {
        void queryClient.invalidateQueries({ queryKey: ['simulation'] });
      }
    };
    const client = createRealtimeClient({
      url: realtimeUrl(token),
      onMessage,
      onStatus: setStatus,
      poll: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.missionState });
        void queryClient.invalidateQueries({ queryKey: ['simulation'] });
      },
    });
    return () => client.close();
  }, [enabled, token, queryClient, setStatus]);

  return null;
}
