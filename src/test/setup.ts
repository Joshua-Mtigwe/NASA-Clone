// IndexedDB for Dexie (offline queue) in jsdom.
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Pages are lazy chunks (route-level code splitting); the first visit to a route in a
// test file transforms that chunk, which can take over a second in a parallel run.
configure({ asyncUtilTimeout: 5000 });

/*
 * Test-environment shim. Under Vitest's jsdom environment, AbortSignal comes from
 * jsdom while Request comes from Node (undici), and undici rejects the foreign
 * signal. React Router's data router builds a Request with a signal on every
 * navigation, so navigations would fail in tests only. Browsers are unaffected.
 * The shim drops the signal (instanceof checks cannot tell the two classes apart
 * once jsdom's globals are installed); tests do not rely on aborting requests.
 */
if (typeof window !== 'undefined' && typeof globalThis.Request === 'function') {
  const NodeRequest = globalThis.Request;

  class CompatRequest extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init?.signal ? { ...init, signal: undefined } : init);
    }
  }
  globalThis.Request = CompatRequest as typeof Request;
}

/*
 * jsdom has no ResizeObserver or layout. Recharts' ResponsiveContainer needs both,
 * so report a fixed 800 x 240 box. Chart tests assert labels and tables, not pixels.
 */
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class FixedResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 800, height: 240 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = FixedResizeObserver as unknown as typeof ResizeObserver;
}
