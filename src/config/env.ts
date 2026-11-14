export type ApiMode = 'mock' | 'live';

export interface RuntimeEnv {
  VITE_API_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_DEMO_MODE?: string;
  VITE_MIND_CHAT_URL?: string;
}

/** `VITE_API_MODE` selects MSW mock handlers or the real FastAPI backend. Defaults to mock. */
export function resolveApiMode(env: RuntimeEnv): ApiMode {
  const raw = env.VITE_API_MODE?.trim().toLowerCase();
  if (!raw) return 'mock';
  if (raw === 'mock' || raw === 'live') return raw;
  throw new Error(`Invalid VITE_API_MODE "${env.VITE_API_MODE}". Use "mock" or "live".`);
}

/**
 * Mock mode talks to the same origin (MSW intercepts in the browser).
 * Live mode requires VITE_API_BASE_URL, for example http://localhost:8000.
 */
export function resolveApiBaseUrl(env: RuntimeEnv, mode: ApiMode): string {
  if (mode === 'mock') return '';
  const base = env.VITE_API_BASE_URL?.trim();
  if (!base) throw new Error('VITE_API_BASE_URL is required when VITE_API_MODE=live.');
  return base.replace(/\/+$/, '');
}

/**
 * Demonstration mode opens dashboards from the public role selector without a
 * password. On by default in mock mode; a live deployment must opt in explicitly
 * with VITE_DEMO_MODE=true, and its backend must also allow /auth/demo-session.
 */
export function resolveDemoMode(env: RuntimeEnv, mode: ApiMode): boolean {
  const raw = env.VITE_DEMO_MODE?.trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return mode === 'mock';
}

const env = import.meta.env as RuntimeEnv;

export const apiMode: ApiMode = resolveApiMode(env);
export const apiBaseUrl: string = resolveApiBaseUrl(env, apiMode);
export const isMockMode = apiMode === 'mock';
export const isDemoMode: boolean = resolveDemoMode(env, apiMode);

/**
 * Origin of the AEGIS Mind Companion service. Empty = same origin as the API (mock
 * mode: the Vite dev server proxies /api/v1/mind-chat to the service).
 */
export const mindChatOrigin: string = (env.VITE_MIND_CHAT_URL ?? '').trim().replace(/\/+$/, '');
