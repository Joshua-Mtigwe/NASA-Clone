import { http, HttpResponse, type HttpHandler } from 'msw';
import { API_PREFIX } from '@/api/client';
import { ENDPOINTS, type EndpointKey } from '@/api/endpoints';
import type { ApiErrorBody, Page, Role, SessionUser } from '@/api/types';
import { resolveUser } from './session';

/** Throw inside a resolver to return a FastAPI-style error response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: NonNullable<ApiErrorBody['detail']>,
  ) {
    super(typeof detail === 'string' ? detail : 'Validation error');
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found.`);
export const forbidden = (why = 'Your role does not have access to this resource.') =>
  new HttpError(403, why);
export const fieldError = (field: string, msg: string) =>
  new HttpError(422, [{ loc: ['body', field], msg, type: 'value_error' }]);

export interface RouteContext {
  request: Request;
  params: Record<string, string>;
  url: URL;
  /** null only on public routes. */
  user: SessionUser | null;
  query(name: string): string | undefined;
  queryAll(name: string): string[];
  body<T>(): Promise<T>;
}

export interface RouteSpec {
  /** Public routes skip the bearer token check. */
  public?: boolean;
  /** Roles allowed to call this endpoint. Omit for any signed-in user. */
  roles?: readonly Role[];
  /**
   * Returns the astronaut id the request is about. An astronaut may only access
   * their own records; other allowed roles are unaffected.
   */
  subject?: (ctx: RouteContext) => string | undefined;
  /** HTTP status for a successful response (default 200). */
  status?: number;
  resolve: (ctx: RouteContext) => unknown;
}

export function buildHandler(key: EndpointKey, spec: RouteSpec): HttpHandler {
  const def = ENDPOINTS[key];
  const method = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';

  return http[method](`*${API_PREFIX}${def.path}`, async ({ request, params }) => {
    // MSW answers even with the network off; behave like an unreachable server instead.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return HttpResponse.error();
    const url = new URL(request.url);
    const ctx: RouteContext = {
      request,
      params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      url,
      user: null,
      query: (name) => url.searchParams.get(name) ?? undefined,
      queryAll: (name) => url.searchParams.getAll(name),
      body: async <T>() => {
        try {
          return (await request.clone().json()) as T;
        } catch {
          throw new HttpError(422, [{ loc: ['body'], msg: 'Body must be JSON', type: 'json' }]);
        }
      },
    };

    try {
      if (!spec.public) {
        const user = await resolveUser(request);
        if (!user) throw new HttpError(401, 'Not authenticated.');
        ctx.user = user;
        if (spec.roles && !spec.roles.includes(user.role)) throw forbidden();
        const subject = spec.subject?.(ctx);
        if (user.role === 'astronaut' && subject !== undefined && subject !== user.astronaut_id) {
          throw forbidden('Astronauts can only access their own records.');
        }
      }
      const result = await spec.resolve(ctx);
      if (result === undefined) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(result as never, { status: spec.status ?? 200 });
    } catch (error) {
      if (error instanceof HttpError) {
        return HttpResponse.json({ detail: error.detail }, { status: error.status });
      }
      const message = error instanceof Error ? error.message : 'Mock server error';
      return HttpResponse.json({ detail: message }, { status: 500 });
    }
  });
}

// ---------- small query helpers shared by handlers ----------

export function paginate<T>(
  rows: T[],
  ctx: RouteContext,
  defaultLimit = 500,
  maxLimit = 5000,
): Page<T> {
  const limit = Math.min(
    Math.max(Number(ctx.query('limit') ?? defaultLimit) || defaultLimit, 1),
    maxLimit,
  );
  const offset = Math.max(Number(ctx.query('offset') ?? 0) || 0, 0);
  return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}

/** Inclusive ISO time range filter. Values compare lexically (all timestamps are UTC ISO). */
export function inRange(value: string | null, from?: string, to?: string): boolean {
  if (value === null) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

export function required(ctx: RouteContext, name: string): string {
  const value = ctx.query(name);
  if (!value) {
    throw new HttpError(422, [{ loc: ['query', name], msg: 'Field required', type: 'missing' }]);
  }
  return value;
}
