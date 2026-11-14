import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clapperboard } from 'lucide-react';
import { simulationApi } from '@/api/simulation';
import { queryKeys } from '@/app/queryClient';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { localDb } from '@/features/assessment/offline/db';
import { formatTimestamp } from '@/lib/format';

/**
 * Seeds the known presentation state on the backend, then clears this device's
 * cached data and offline queue so every view starts from that state.
 */
export function DemoStoryControl() {
  const queryClient = useQueryClient();
  const reset = useMutation({
    mutationFn: async () => {
      const state = await simulationApi.demoStory();
      await Promise.all([localDb.outbox.clear(), localDb.completions.clear()]);
      return state;
    },
    onSuccess: async (state) => {
      queryClient.setQueryData(queryKeys.missionState, state);
      // Reset (not remove) so views on screen refetch the seeded state.
      await queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    },
  });

  return (
    <Card className="space-y-3 p-5" role="region" aria-label="Demo story">
      <h2 className="flex items-center gap-2 text-title">
        <Clapperboard className="h-5 w-5 text-accent" aria-hidden="true" /> Demo story
      </h2>
      <p className="text-sm text-ink-muted">
        Resets the mission to a known state for a presentation: mission day 25 at 12:00 UTC,
        simulation paused, all changes made during this session discarded, and this device&apos;s
        offline queue cleared.
      </p>
      <Button onClick={() => reset.mutate()} disabled={reset.isPending}>
        {reset.isPending ? 'Resetting…' : 'Start demo story'}
      </Button>
      {reset.isSuccess && (
        <p role="status" className="text-sm text-status-nominal">
          Demo story ready: Day {reset.data.mission_day} / {reset.data.mission_length_days},{' '}
          {formatTimestamp(reset.data.mission_time)}.
        </p>
      )}
      {reset.isError && (
        <p role="alert" className="text-sm text-status-action">
          {reset.error.message}
        </p>
      )}
    </Card>
  );
}
