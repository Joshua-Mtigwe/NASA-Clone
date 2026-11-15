import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { recoveryApi } from '@/api/recovery';
import type { RoutinePublication } from '@/api/types';
import { useSession } from '@/features/auth/sessionStore';
import { mockState } from '@/mocks/db';
import { setupMockApi, signInAs } from '@/test/appHarness';
import { localDb } from './db';
import { enqueuePublication, flushQueue } from './queue';

setupMockApi();
beforeEach(async () => {
  mockState.missionDayOverride = 25;
  await localDb.outbox.clear();
  await signInAs('mission_leader');
});
afterEach(() => vi.restoreAllMocks());

it('persists one request per recommendation and marks only confirmed publication as sent', async () => {
  const publish = vi
    .spyOn(recoveryApi, 'publish')
    .mockResolvedValue({ state: 'published' } as RoutinePublication);
  await enqueuePublication('REC-queue', { scheduled_start: '2027-03-25T14:00:00Z' });
  await enqueuePublication('REC-queue', {});
  expect(await localDb.outbox.count()).toBe(1);
  expect(publish).not.toHaveBeenCalled();
  expect(await flushQueue()).toMatchObject({ sent: 1, remaining: 0 });
  expect(publish).toHaveBeenCalledTimes(1);
});

it('retains a publication during a network outage and retries after recovery', async () => {
  const publish = vi.spyOn(recoveryApi, 'publish').mockRejectedValue(
    new ApiError({
      status: 0,
      kind: 'network',
      message: 'Offline',
      method: 'POST',
      path: '/recovery',
    }),
  );
  await enqueuePublication('REC-offline', {});
  expect(await flushQueue()).toMatchObject({ sent: 0, remaining: 1, offline: true });
  expect((await localDb.outbox.toArray())[0]!.status).toBe('pending');
  publish.mockResolvedValue({ state: 'published' } as RoutinePublication);
  expect(await flushQueue()).toMatchObject({ sent: 1, remaining: 0 });
});

it('surfaces a scheduling conflict instead of treating it as a successful publication', async () => {
  vi.spyOn(recoveryApi, 'publish').mockResolvedValue({
    state: 'unable_to_schedule',
    reasons: ['Protected sleep'],
  } as RoutinePublication);
  await enqueuePublication('REC-conflict', {});
  expect(await flushQueue()).toMatchObject({ sent: 0, remaining: 1 });
  expect((await localDb.outbox.toArray())[0]).toMatchObject({
    status: 'failed',
    lastError: 'Protected sleep',
  });
});

it('never replays a leader publication as a different selected persona', async () => {
  const publish = vi.spyOn(recoveryApi, 'publish');
  await enqueuePublication('REC-owner', {});
  useSession.getState().clear();
  await signInAs('astronaut');
  expect(await flushQueue()).toMatchObject({ sent: 0, remaining: 1 });
  expect(publish).not.toHaveBeenCalled();
});
