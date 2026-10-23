import { afterEach, describe, expect, it, vi } from 'vitest';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ApiError, parseBody, toValidationIssues, withHandler } from '@/lib/api';
import { setErrorSink } from '@/lib/observability';

async function json(response: Response) {
  return response.json() as Promise<unknown>;
}

describe('API response helpers', () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects cross-origin %s before the handler can mutate state', async (method) => {
    const mutate = vi.fn(() => ({ saved: true }));
    const handler = withHandler(mutate);
    // A same-site sibling can send cookies with a simple text/plain request.
    const response = await handler(new Request('https://app.example.test/api', {
      method, headers: { origin: 'https://notebook.example.test', 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' },
      body: '{"saved":true}',
    }));
    expect(response.status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each<HeadersInit>([{ origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])('rejects untrusted browser mutation metadata: %j', async (headers) => {
    const mutate = vi.fn(() => ({ saved: true }));
    const response = await withHandler(mutate)(new Request('https://app.example.test/api', { method: 'POST', headers }));
    expect(response.status).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each<RequestInit>([
    { method: 'POST', headers: { origin: 'https://app.example.test' } },
    { method: 'POST', headers: {} },
    { method: 'GET', headers: { origin: 'https://elsewhere.example.test' } },
  ])('preserves same-origin mutations, server callers, and public reads: %j', async (init) => {
    const response = await withHandler(() => ({ ok: true }))(new Request('https://app.example.test/api', init));
    expect(response.status).toBe(200);
  });

  it('wraps successful handler data in the data envelope', async () => {
    const handler = withHandler(async () => ({ courseId: 'course-1' }));

    const response = await handler(new Request('http://localhost/api'));

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toEqual({ data: { courseId: 'course-1' } });
  });

  it('converts an ApiError to its requested error envelope', async () => {
    const handler = withHandler(async () => { throw new ApiError(403, 'FORBIDDEN', 'Permission denied'); });

    const response = await handler(new Request('http://localhost/api'));

    expect(response.status).toBe(403);
    await expect(json(response)).resolves.toEqual({ error: { code: 'FORBIDDEN', message: 'Permission denied' } });
  });

  it('emits optional ApiError response headers without changing the error envelope', async () => {
    const handler = withHandler(async () => {
      throw new ApiError(429, 'RATE_LIMITED', 'Slow down', undefined, { 'Retry-After': '60' });
    });

    const response = await handler(new Request('http://localhost/api'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(json(response)).resolves.toEqual({ error: { code: 'RATE_LIMITED', message: 'Slow down' } });
  });

  it('returns validation issues for a zod-invalid request body', async () => {
    const handler = withHandler(async (request) => parseBody(z.object({ name: z.string().min(1) }), request));

    const response = await handler(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ name: '' }) }));

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', issues: [{ path: ['name'], message: 'Too small: expected string to have >=1 characters' }] } });
  });

  it('does not include invalid submitted values in validation issues', async () => {
    const handler = withHandler(async (request) => parseBody(z.object({ password: z.number() }), request));

    const response = await handler(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ password: 'do-not-expose' }) }));

    expect(JSON.stringify(await json(response))).not.toContain('do-not-expose');
  });

  it('rejects malformed JSON as a client error instead of an internal error', async () => {
    const handler = withHandler(async (request) => parseBody(z.object({ name: z.string() }), request));

    const response = await handler(new Request('http://localhost/api', { method: 'POST', body: '{' }));

    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toEqual({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' } });
  });

  it('enforces a caller-supplied parseBody byte limit before schema validation', async () => {
    let schemaVisited = false;
    const schema = z.unknown().transform((value) => {
      schemaVisited = true;
      return value;
    });
    const handler = withHandler(async (request) => parseBody(schema, request, { maxBytes: 1 }));

    const response = await handler(new Request('http://localhost/api', { method: 'POST', body: '{}' }));

    expect(response.status).toBe(413);
    await expect(json(response)).resolves.toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(schemaVisited).toBe(false);
  });

  it('rejects JSON nesting deeper than 64 before schema validation', async () => {
    let schemaVisited = false;
    const schema = z.unknown().transform((value) => {
      schemaVisited = true;
      return value;
    });
    const handler = withHandler(async (request) => parseBody(schema, request));
    const body = '['.repeat(65) + '0' + ']'.repeat(65);

    const response = await handler(new Request('http://localhost/api', { method: 'POST', body }));

    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toMatchObject({ error: { code: 'JSON_NESTING_TOO_DEEP' } });
    expect(schemaVisited).toBe(false);
  });

  it('reports unexpected errors with a correlation id while returning only the safe id to callers', async () => {
    const failure = new Error('password=do-not-expose');
    const sink = vi.fn();
    const restore = setErrorSink(sink);
    const handler = withHandler(async () => { throw failure; });

    try {
      const response = await handler(new Request('http://localhost/api'));

      expect(response.status).toBe(500);
      const body = await json(response) as { error: { code: string; message: string; correlationId: string } };
      expect(body).toEqual({ error: { code: 'INTERNAL', message: 'Internal error', correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) } });
      expect(JSON.stringify(body)).not.toContain('do-not-expose');
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({
        correlationId: body.error.correlationId,
        error: failure,
        context: { area: 'api', method: 'GET', pathname: '/api' },
      }));
    } finally {
      restore();
    }
  });

  it.each(['NEXT_REDIRECT;replace;/login;307;', 'NEXT_NOT_FOUND'])('rethrows Next control-flow error %s', async (digest) => {
    const controlFlowError = Object.assign(new Error('framework control flow'), { digest });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = withHandler(async () => { throw controlFlowError; });

    await expect(handler(new Request('http://localhost/api'))).rejects.toBe(controlFlowError);
    expect(log).not.toHaveBeenCalled();
  });

  it('rethrows the real Next 15 notFound control-flow error', async () => {
    const handler = withHandler(async () => notFound());

    await expect(handler(new Request('http://localhost/api'))).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it('uses Next control-flow detection for framework errors wrapped as a cause', async () => {
    const controlFlowError = Object.assign(new Error('framework control flow'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    const wrapped = new Error('library wrapper', { cause: controlFlowError });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = withHandler(async () => { throw wrapped; });

    await expect(handler(new Request('http://localhost/api'))).rejects.toBe(controlFlowError);
    expect(log).not.toHaveBeenCalled();
  });

  it('normalizes library diagnostics to the hardened public issue shape', () => {
    // `path` and `message` keep their exact previous form; everything else is
    // additive, so the structured diagnostic survives the envelope instead of being
    // flattened into a string the UI then has to guess at.
    expect(toValidationIssues([
      { path: ['questions', 0, 'id'], message: 'Duplicate id', code: 'custom' },
      { docId: 'manifest', path: '/modules/0/title', message: { en: 'Title is required', vi: 'Thiếu tiêu đề' } },
    ])).toEqual([
      { path: ['questions', 0, 'id'], message: 'Duplicate id', code: 'custom' },
      {
        path: ['manifest', 'modules', 0, 'title'],
        message: 'Title is required',
        docId: 'manifest',
        pointer: '/modules/0/title',
        localizedMessage: { en: 'Title is required', vi: 'Thiếu tiêu đề' },
      },
    ]);
  });

  it('carries the diagnostic reference, severity, range and revision through the envelope', () => {
    const [issue] = toValidationIssues([{
      code: 'E_JSON_DUPLICATE_KEY',
      severity: 'error',
      ref: { kind: 'item', id: 'manifest' },
      docId: 'manifest',
      path: '/id',
      message: { en: 'Property "id" is declared twice', vi: 'Thuộc tính "id" bị khai báo hai lần' },
      range: { start: { line: 3, col: 3 }, end: { line: 3, col: 7 } },
      revision: 'abcd1234',
    }]);

    // An item whose id is literally `manifest` stays an item on the wire: the legacy
    // path/docId cannot express that, the ref can.
    expect(issue).toMatchObject({
      code: 'E_JSON_DUPLICATE_KEY',
      severity: 'error',
      ref: { kind: 'item', id: 'manifest' },
      pointer: '/id',
      range: { start: { line: 3, col: 3 } },
      revision: 'abcd1234',
      localizedMessage: { vi: 'Thuộc tính "id" bị khai báo hai lần' },
    });
  });

  it('omits every additive field a producer did not supply', () => {
    expect(toValidationIssues([{ path: ['a'], message: 'plain' }])).toEqual([{ path: ['a'], message: 'plain' }]);
  });
});
