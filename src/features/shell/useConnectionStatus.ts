import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { isApiError } from '@/api/client';
import { useOutboxStatus } from '@/features/assessment/offline/queue';
import { useMissionState } from './useMissionState';

export type ConnectionStatus = 'offline' | 'syncing' | 'synced';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

const getOnline = () => navigator.onLine;

export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribe, getOnline, () => true);
}

/**
 * Offline: the browser is offline, or the mission server is unreachable.
 * Syncing: requests or writes are in flight, or items wait in the offline queue.
 * Synced: otherwise.
 */
export function useConnectionStatus(): ConnectionStatus {
  const online = useBrowserOnline();
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const mission = useMissionState();
  const outbox = useOutboxStatus();

  const unreachable = isApiError(mission.error) && mission.error.kind === 'network';
  if (!online || unreachable) return 'offline';
  if (fetching + mutating > 0 || outbox.pending > 0) return 'syncing';
  return 'synced';
}
