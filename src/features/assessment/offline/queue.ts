/**
 * Offline-first outbox for assessment data. Trials and completions are written to
 * IndexedDB first, then sent in order when the API is reachable. A network failure
 * leaves items queued for the next flush; any other error marks the item failed
 * and holds back later items for the same session.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { assessmentsApi } from '@/api/assessments';
import { recoveryApi } from '@/api/recovery';
import { useSession } from '@/features/auth/sessionStore';
import { ApiError } from '@/api/client';
import { planningApi } from '@/api/planning';
import { isApiError } from '@/api/client';
import type {
  CompleteSessionRequest,
  ContextInput,
  ScheduleOverrideRequest,
  SubmitTrialsRequest,
  PublishRoutineRequest,
} from '@/api/types';
import { localDb, type OutboxItem } from './db';

const nowIso = () => new Date().toISOString();

export async function enqueueTrials(
  sessionId: string,
  payload: SubmitTrialsRequest,
): Promise<void> {
  await localDb.outbox.add({
    kind: 'trials',
    sessionId,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
}

export async function enqueueCompletion(
  sessionId: string,
  payload: CompleteSessionRequest,
): Promise<void> {
  await localDb.outbox.add({
    kind: 'complete',
    sessionId,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
}

/** A subjective check-in, sent before the session's completion. */
export async function enqueueContext(sessionId: string, payload: ContextInput): Promise<void> {
  await localDb.outbox.add({
    kind: 'context',
    sessionId,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
}

/** A manual schedule override (grouped by schedule version). */
export async function enqueueOverride(
  scheduleVersionId: string,
  payload: ScheduleOverrideRequest,
): Promise<void> {
  await localDb.outbox.add({
    kind: 'override',
    sessionId: scheduleVersionId,
    payload,
    createdAt: nowIso(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
}

/** Persist a routine publication until the same leader reconnects. */
export async function enqueuePublication(
  recommendationId: string,
  payload: PublishRoutineRequest,
): Promise<void> {
  const ownerUserId = useSession.getState().user?.user_id;
  if (!ownerUserId) throw new Error('Select a demo role before publishing.');
  const existing = await localDb.outbox.where('sessionId').equals(recommendationId).toArray();
  if (existing.some((i) => i.kind === 'publish' && i.ownerUserId === ownerUserId)) return;
  await localDb.outbox.add({
    kind: 'publish',
    sessionId: recommendationId,
    payload,
    ownerUserId,
    createdAt: nowIso(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  });
}

export interface FlushResult {
  sent: number;
  remaining: number;
  offline: boolean;
}

async function send(item: OutboxItem): Promise<void> {
  if (item.kind === 'publish') {
    const result = await recoveryApi.publish(item.sessionId, item.payload);
    if (result.state !== 'published') {
      throw new ApiError({
        status: 409,
        kind: 'conflict',
        message: result.reasons.join('; ') || 'Routine could not be published',
        method: 'POST',
        path: '/recovery',
      });
    }
  } else if (item.kind === 'trials') {
    await assessmentsApi.submitTrials(item.sessionId, item.payload);
  } else if (item.kind === 'context') {
    await assessmentsApi.submitContext(item.payload);
  } else if (item.kind === 'override') {
    await planningApi.overrideSchedule(item.sessionId, item.payload);
  } else {
    const completion = await assessmentsApi.completeSession(item.sessionId, item.payload);
    await localDb.completions.put({ sessionId: item.sessionId, completion, receivedAt: nowIso() });
  }
}

let running: Promise<FlushResult> | null = null;

/**
 * Send queued items oldest first. A call made while a flush is running waits for it
 * and then flushes again, so items queued (or a reconnect) mid-run are not missed.
 */
export function flushQueue(): Promise<FlushResult> {
  if (running) return running.then(() => flushQueue());
  running = (async () => {
    let sent = 0;
    let offline = false;
    const blocked = new Set<string>();
    const items = await localDb.outbox.orderBy('seq').toArray();
    for (const item of items) {
      if (item.kind === 'publish' && item.ownerUserId !== useSession.getState().user?.user_id)
        continue;
      if (item.status === 'failed') {
        blocked.add(item.sessionId);
        continue;
      }
      if (blocked.has(item.sessionId)) continue;
      try {
        await send(item);
        await localDb.outbox.delete(item.seq!);
        sent += 1;
      } catch (error) {
        const network = isApiError(error) && error.kind === 'network';
        await localDb.outbox.update(item.seq!, {
          attempts: item.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
          status: network ? 'pending' : 'failed',
        });
        if (network) {
          offline = true;
          break;
        }
        blocked.add(item.sessionId);
      }
    }
    return { sent, remaining: await localDb.outbox.count(), offline };
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Flush now, whenever the browser comes back online, and every 30 s. */
export function startQueueSync(intervalMs = 30_000, onSynced?: () => void): () => void {
  const flush = () =>
    void flushQueue()
      .then((r) => {
        if (r.sent) onSynced?.();
      })
      .catch(() => undefined);
  window.addEventListener('online', flush);
  const timer = window.setInterval(flush, intervalMs);
  flush();
  return () => {
    window.removeEventListener('online', flush);
    window.clearInterval(timer);
  };
}

export function useOutboxStatus() {
  const items = useLiveQuery(() => localDb.outbox.toArray(), [], undefined);
  return {
    loading: items === undefined,
    pending: items?.filter((i) => i.status === 'pending').length ?? 0,
    failed: items?.filter((i) => i.status === 'failed') ?? [],
  };
}

export function useCompletion(sessionId: string | null) {
  return useLiveQuery(
    () => (sessionId ? localDb.completions.get(sessionId) : undefined),
    [sessionId],
  );
}
