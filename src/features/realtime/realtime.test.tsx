import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionState } from '@/api/types';
import { queryKeys } from '@/app/queryClient';
import { useSession } from '@/features/auth/sessionStore';
import { useUi } from '@/features/shell/uiStore';
import { backoffDelay, createRealtimeClient, type RealtimeTimers } from './client';
import { RealtimeBridge } from './RealtimeBridge';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  drop() {
    this.onclose?.();
  }
  close() {
    this.closed = true;
  }
}

function manualTimers() {
  const timeouts: Array<{ fn: () => void; ms: number; id: number }> = [];
  const intervals = new Map<number, () => void>();
  let id = 0;
  const timers: RealtimeTimers = {
    setTimeout: (fn, ms) => {
      timeouts.push({ fn, ms, id: ++id });
      return id;
    },
    clearTimeout: (h) => {
      const i = timeouts.findIndex((t) => t.id === h);
      if (i >= 0) timeouts.splice(i, 1);
    },
    setInterval: (fn) => {
      intervals.set(++id, fn);
      return id;
    },
    clearInterval: (h) => intervals.delete(h as number),
  };
  return { timers, timeouts, intervals, runNext: () => timeouts.shift()?.fn() };
}

beforeEach(() => {
  FakeSocket.instances = [];
});

describe('realtime client', () => {
  it('reconnects with exponential backoff after the connection drops', () => {
    const t = manualTimers();
    const statuses: string[] = [];
    createRealtimeClient({
      url: 'ws://test/api/v1/ws',
      WebSocketImpl: FakeSocket as unknown as { new (url: string): WebSocket },
      onMessage: () => undefined,
      poll: () => undefined,
      onStatus: (s) => statuses.push(s),
      timers: t.timers,
      baseDelayMs: 1000,
      maxDelayMs: 15_000,
    });
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.drop();
    expect(t.timeouts[0]!.ms).toBe(1000);
    t.runNext();
    FakeSocket.instances[1]!.drop();
    expect(t.timeouts[0]!.ms).toBe(2000);
    t.runNext();
    expect(FakeSocket.instances).toHaveLength(3);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'reconnecting']);
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 1000, 15_000))).toEqual([
      1000, 2000, 4000, 8000, 15_000, 15_000,
    ]);
  });

  it('falls back to polling after repeated failures and stops polling once reconnected', () => {
    const t = manualTimers();
    const poll = vi.fn();
    const statuses: string[] = [];
    createRealtimeClient({
      url: 'ws://test/api/v1/ws',
      WebSocketImpl: FakeSocket as unknown as { new (url: string): WebSocket },
      onMessage: () => undefined,
      poll,
      onStatus: (s) => statuses.push(s),
      timers: t.timers,
      maxRetries: 2,
    });
    FakeSocket.instances[0]!.drop();
    t.runNext();
    FakeSocket.instances[1]!.drop();
    t.runNext();
    FakeSocket.instances[2]!.drop(); // third failure > maxRetries
    expect(statuses.at(-1)).toBe('polling');
    expect(poll).toHaveBeenCalledTimes(1);
    expect(t.intervals.size).toBe(1);

    t.runNext(); // background reconnect attempt
    FakeSocket.instances[3]!.open();
    expect(statuses.at(-1)).toBe('open');
    expect(t.intervals.size).toBe(0);
  });
});

describe('realtime bridge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes live mission state into the cache so the header updates without a reload', () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    useSession.setState({ token: 'mock-token.USR-008' });
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <RealtimeBridge enabled />
      </QueryClientProvider>,
    );
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toMatch(/^ws:\/\/.+\/api\/v1\/ws$/);
    act(() => socket.open());
    expect(useUi.getState().realtimeStatus).toBe('open');

    const state = { mission_day: 26, mission_time: '2027-03-26T09:00:00Z' } as MissionState;
    act(() => socket.message({ type: 'simulation_tick', payload: state }));
    expect(client.getQueryData(queryKeys.missionState)).toEqual(state);

    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => socket.message({ type: 'alert', payload: { astronaut_id: 'AST-002' } }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['astronauts', 'AST-002', 'alerts'] });
    unmount();
    expect(socket.closed).toBe(true);
  });
});
