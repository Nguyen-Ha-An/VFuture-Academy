import { describe, expect, it } from 'vitest';

import { readJsonBodyLimited, readTextBodyLimited } from '@/lib/body-limit';

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request('http://localhost/api', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('limited request body readers', () => {
  it('rejects an oversized declared Content-Length before reading the body', async () => {
    const request = streamedRequest([new TextEncoder().encode('{}')], { 'content-length': '6' });

    await expect(readTextBodyLimited(request, 5)).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('counts chunked body bytes when Content-Length is missing', async () => {
    const request = streamedRequest([
      new TextEncoder().encode('123'),
      new TextEncoder().encode('456'),
    ]);

    await expect(readTextBodyLimited(request, 5)).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('does not trust a non-numeric Content-Length', async () => {
    const request = streamedRequest([
      new TextEncoder().encode('123'),
      new TextEncoder().encode('456'),
    ], { 'content-length': 'unknown' });

    await expect(readTextBodyLimited(request, 5)).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('parses JSON only after the byte-limited read succeeds', async () => {
    const request = streamedRequest([new TextEncoder().encode('{"safe":true}')]);

    await expect(readJsonBodyLimited(request, 32)).resolves.toEqual({ safe: true });
  });

  it('reports malformed JSON as a client error', async () => {
    const request = streamedRequest([new TextEncoder().encode('{')]);

    await expect(readJsonBodyLimited(request, 32)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_JSON',
    });
  });

  it('rejects JSON nesting deeper than the engine limit before parsing', async () => {
    const body = '['.repeat(65) + '0' + ']'.repeat(65);
    const request = streamedRequest([new TextEncoder().encode(body)]);

    await expect(readJsonBodyLimited(request, 1024)).rejects.toMatchObject({
      status: 400,
      code: 'JSON_NESTING_TOO_DEEP',
    });
  });
});
