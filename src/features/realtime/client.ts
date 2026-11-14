/**
 * Realtime client: WebSocket with exponential-backoff reconnect. After `maxRetries`
 * consecutive failures it falls back to polling, and keeps trying to reconnect in the
 * background; a successful connection stops polling.
 */
import type { RealtimeMessage } from '@/api/types';

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'polling' | 'closed';

export interface RealtimeTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

const browserTimers: RealtimeTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
};

export interface RealtimeOptions {
  url: string;
  onMessage: (message: RealtimeMessage) => void;
  poll: () => void;
  onStatus?: (status: RealtimeStatus) => void;
  WebSocketImpl?: { new (url: string): WebSocket };
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  pollIntervalMs?: number;
  timers?: RealtimeTimers;
}

export interface RealtimeClient {
  close(): void;
  status(): RealtimeStatus;
}

export function backoffDelay(attempt: number, base: number, max: number): number {
  return Math.min(base * 2 ** Math.max(0, attempt - 1), max);
}

export function createRealtimeClient(o: RealtimeOptions): RealtimeClient {
  const Impl = o.WebSocketImpl ?? WebSocket;
  const timers = o.timers ?? browserTimers;
  const maxRetries = o.maxRetries ?? 4;
  const base = o.baseDelayMs ?? 1000;
  const max = o.maxDelayMs ?? 15_000;
  let status: RealtimeStatus = 'connecting';
  let socket: WebSocket | null = null;
  let attempts = 0;
  let stopped = false;
  let retry: unknown = null;
  let pollTimer: unknown = null;

  const set = (s: RealtimeStatus) => {
    status = s;
    o.onStatus?.(s);
  };

  const stopPolling = () => {
    if (pollTimer !== null) timers.clearInterval(pollTimer);
    pollTimer = null;
  };

  const startPolling = () => {
    if (pollTimer === null) {
      o.poll();
      pollTimer = timers.setInterval(o.poll, o.pollIntervalMs ?? 5000);
    }
    set('polling');
  };

  function connect() {
    if (stopped) return;
    if (status !== 'polling') set(attempts === 0 ? 'connecting' : 'reconnecting');
    try {
      socket = new Impl(o.url);
    } catch {
      onClose();
      return;
    }
    socket.onopen = () => {
      attempts = 0;
      stopPolling();
      set('open');
    };
    socket.onmessage = (e: MessageEvent) => {
      try {
        o.onMessage(JSON.parse(String(e.data)) as RealtimeMessage);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = onClose;
  }

  function onClose() {
    if (stopped) return;
    socket = null;
    attempts += 1;
    if (attempts > maxRetries) {
      startPolling();
      retry = timers.setTimeout(connect, max);
    } else {
      retry = timers.setTimeout(connect, backoffDelay(attempts, base, max));
    }
  }

  connect();

  return {
    close() {
      stopped = true;
      if (retry !== null) timers.clearTimeout(retry);
      stopPolling();
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      set('closed');
    },
    status: () => status,
  };
}
