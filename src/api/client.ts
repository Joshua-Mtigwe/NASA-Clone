/**
 * Fetch wrapper for /api/v1: base URL, auth header, JSON handling and error
 * normalisation. 401 and 403 responses notify registered handlers (the session
 * store signs out on 401; the router shows the 403 page) and always throw ApiError.
 */
import { apiBaseUrl, isMockMode } from '@/config/env';
import { buildPath, ENDPOINTS, type EndpointKey } from './endpoints';
import type { ApiErrorBody } from './types';

export const API_PREFIX = '/api/v1';

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'server'
  | 'unknown';

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly fieldErrors: FieldError[];
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(init: {
    status: number;
    kind: ApiErrorKind;
    message: string;
    fieldErrors?: FieldError[];
    method: string;
    path: string;
    body?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.kind = init.kind;
    this.fieldErrors = init.fieldErrors ?? [];
    this.method = init.method;
    this.path = init.path;
    this.body = init.body;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

const DEFAULT_MESSAGES: Record<ApiErrorKind, string> = {
  network: 'Cannot reach the mission server. Check the connection and try again.',
  unauthorized: 'Your session has ended. Sign in again.',
  forbidden: 'Your role does not have access to this information.',
  not_found: 'The requested record was not found.',
  validation: 'Some fields are not valid.',
  conflict: 'This record was changed elsewhere. Reload and try again.',
  server: 'The mission server returned an error. Try again shortly.',
  unknown: 'Something went wrong.',
};

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Turn any error response body (FastAPI style or not) into a consistent ApiError. */
export function normaliseError(
  status: number,
  body: unknown,
  method: string,
  path: string,
): ApiError {
  const kind = kindForStatus(status);
  let message = DEFAULT_MESSAGES[kind];
  let fieldErrors: FieldError[] = [];

  const detail =
    (body as ApiErrorBody | null | undefined)?.detail ??
    (body as { message?: string } | null)?.message;
  if (typeof detail === 'string' && detail.trim()) {
    message = detail;
  } else if (Array.isArray(detail)) {
    fieldErrors = detail.map((d) => ({
      field: (d.loc ?? []).filter((part) => part !== 'body' && part !== 'query').join('.'),
      message: d.msg ?? 'Invalid value',
    }));
    if (fieldErrors.length > 0) {
      message = fieldErrors
        .map((f) => (f.field ? `${f.field}: ${f.message}` : f.message))
        .join('; ');
    }
  }
  return new ApiError({ status, kind, message, fieldErrors, method, path, body });
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized: (error: ApiError) => void;
  onForbidden: (error: ApiError) => void;
  fetchImpl: typeof fetch | null;
}

const options: ApiClientOptions = {
  baseUrl: apiBaseUrl,
  getToken: () => null,
  onUnauthorized: () => undefined,
  onForbidden: () => undefined,
  fetchImpl: null,
};

export function configureApiClient(partial: Partial<ApiClientOptions>): void {
  Object.assign(options, partial);
}

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: object;
  body?: unknown;
  signal?: AbortSignal;
  /** Origin override for a service hosted apart from the main backend. */
  origin?: string;
}

function buildUrl(path: string, query?: object, originOverride?: string): string {
  const origin =
    originOverride ||
    options.baseUrl ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const url = new URL(`${origin}${API_PREFIX}${path}`);
  for (const [key, value] of Object.entries((query ?? {}) as Query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  { query, body, signal, origin }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = options.getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    if (!isMockMode && token.startsWith('mock-token.')) {
      headers['X-AEGIS-User'] = token.slice('mock-token.'.length);
    }
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await doFetch(buildUrl(path, query, origin), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      kind: 'network',
      message: DEFAULT_MESSAGES.network,
      method,
      path,
      body: cause,
    });
  }

  const payload = await readBody(response);
  if (response.ok) return payload as T;

  const error = normaliseError(response.status, payload, method, path);
  if (error.kind === 'unauthorized') options.onUnauthorized(error);
  if (error.kind === 'forbidden') options.onForbidden(error);
  throw error;
}

/** Call a registered endpoint by key. */
export function callEndpoint<T>(
  key: EndpointKey,
  params: Record<string, string> = {},
  init: RequestOptions = {},
): Promise<T> {
  const def = ENDPOINTS[key];
  return apiRequest<T>(
    def.method,
    `${!isMockMode && !key.startsWith('mindChat.') && !key.startsWith('ai.') ? '/console' : ''}${buildPath(def.path, params)}`,
    init,
  );
}
