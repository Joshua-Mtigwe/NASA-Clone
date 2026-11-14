import { API_PREFIX } from '@/api/client';
import { apiBaseUrl, isMockMode } from '@/config/env';

/** WS /api/v1/ws: same origin in mock mode; the FastAPI host (with the token) in live mode. */
export function realtimeUrl(
  token: string | null,
  mock: boolean = isMockMode,
  base: string = apiBaseUrl,
): string {
  if (mock || !base) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}${API_PREFIX}/ws`;
  }
  return `${base.replace(/^http/, 'ws')}${API_PREFIX}/ws?token=${encodeURIComponent(token ?? '')}`;
}
