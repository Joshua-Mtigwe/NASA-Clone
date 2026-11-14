import type { Clock, Timers } from '@/features/assessment/engine/types';

/** Deterministic clock and timers for engine tests. Time moves only via advance(). */
export function createManualClock() {
  let now = 0;
  let nextId = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();

  const clock: Clock = { now: () => now };
  const timers: Timers = {
    set: (fn, ms) => {
      nextId += 1;
      queue.set(nextId, { at: now + ms, fn });
      return nextId;
    },
    clear: (handle) => {
      queue.delete(handle as number);
    },
  };

  /** Run every timer due within `ms`, in time order, then land on now + ms. */
  function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of queue) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      queue.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = target;
  }

  return { clock, timers, advance, now: () => now };
}
