// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, configureApiClient } from './client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function useFetch(response: Response | Error) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  configureApiClient({ baseUrl: 'http://api.test', fetchImpl });
  return fetchImpl;
}

afterEach(() => {
  configureApiClient({
    baseUrl: '',
    fetchImpl: null,
    getToken: () => null,
    onUnauthorized: () => undefined,
    onForbidden: () => undefined,
  });
});

describe('apiRequest', () => {
  it('prefixes /api/v1, encodes the query, sends the bearer token and parses JSON', async () => {
    const fetchImpl = useFetch(jsonResponse(200, { ok: true }));
    configureApiClient({ getToken: () => 'tok-123' });

    const result = await apiRequest<{ ok: boolean }>('GET', '/vitals/history', {
      query: { astronaut_id: 'AST-001', from: undefined, limit: 50 },
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/v1/vitals/history?astronaut_id=AST-001&limit=50');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('normalises a FastAPI string detail into an ApiError with status and kind', async () => {
    useFetch(jsonResponse(404, { detail: 'Astronaut not found.' }));

    const error = await apiRequest('GET', '/astronauts/AST-999').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      kind: 'not_found',
      message: 'Astronaut not found.',
      method: 'GET',
      path: '/astronauts/AST-999',
    });
  });

  it('turns a 422 validation list into field errors', async () => {
    useFetch(
      jsonResponse(422, {
        detail: [{ loc: ['body', 'reason'], msg: 'A reason is required', type: 'value_error' }],
      }),
    );

    const error = (await apiRequest('POST', '/planning/schedules/SV/overrides', {
      body: {},
    }).catch((e: unknown) => e)) as ApiError;

    expect(error.kind).toBe('validation');
    expect(error.fieldErrors).toEqual([{ field: 'reason', message: 'A reason is required' }]);
    expect(error.message).toBe('reason: A reason is required');
  });

  it('calls the unauthorised handler on 401 and the forbidden handler on 403', async () => {
    const onUnauthorized = vi.fn();
    const onForbidden = vi.fn();
    configureApiClient({ onUnauthorized, onForbidden });

    useFetch(jsonResponse(401, { detail: 'Not authenticated.' }));
    await expect(apiRequest('GET', '/auth/me')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onForbidden).not.toHaveBeenCalled();

    useFetch(jsonResponse(403, {}));
    const error = (await apiRequest('GET', '/research/overview').catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.kind).toBe('forbidden');
    expect(error.message).toBe('Your role does not have access to this information.');
    expect(onForbidden).toHaveBeenCalledWith(error);
  });

  it('reports an unreachable server as a network error with status 0', async () => {
    useFetch(new TypeError('Failed to fetch'));

    await expect(apiRequest('GET', '/missions/current/state')).rejects.toMatchObject({
      status: 0,
      kind: 'network',
    });
  });
});
