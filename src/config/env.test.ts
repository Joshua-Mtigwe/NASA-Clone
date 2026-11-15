import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl, resolveApiMode } from './env';

describe('VITE_API_MODE switching', () => {
  it('defaults to mock, accepts live with a base URL, and rejects anything else', () => {
    expect(resolveApiMode({})).toBe('mock');
    expect(resolveApiMode({ VITE_API_MODE: 'mock' })).toBe('mock');
    expect(resolveApiBaseUrl({}, 'mock')).toBe('');

    const live = { VITE_API_MODE: 'LIVE', VITE_API_BASE_URL: 'http://localhost:8000/' };
    expect(resolveApiMode(live)).toBe('live');
    expect(resolveApiBaseUrl(live, 'live')).toBe('http://localhost:8000');

    expect(resolveApiBaseUrl({ VITE_API_MODE: 'live' }, 'live')).toBe('');
    expect(() => resolveApiMode({ VITE_API_MODE: 'staging' })).toThrow(/Invalid VITE_API_MODE/);
  });
});
