import { describe, it, expect } from 'vitest';

import { MAX_DOCUMENT_BYTES, MAX_ENVELOPE_BYTES } from '@/content-engine/validate/parse';
import { decodeStrictUtf8, readStrictJsonBodyLimited, readStrictTextBodyLimited, readTextBodyLimited, MAX_WIRE_BODY_BYTES } from '@/lib/body-limit';
import { itemRef } from '@/content-engine/diagnostics';

/** A request whose body is exactly these bytes — no string round-trip in between. */
const rawRequest = (bytes: Uint8Array) =>
  new Request('http://localhost/strict', { method: 'POST', body: bytes as unknown as BodyInit });

const textRequest = (text: string) => rawRequest(new TextEncoder().encode(text));

const issues = async (request: Request, opts?: Parameters<typeof readStrictJsonBodyLimited>[1]) => {
  try {
    await readStrictJsonBodyLimited(request, opts);
    throw new Error('expected the strict reader to reject this body');
  } catch (error) {
    const api = error as { status?: number; code?: string; issues?: { code?: string; message: string }[] };
    if (api.status === undefined) throw error;
    return { status: api.status, code: api.code, codes: (api.issues ?? []).map((issue) => issue.code) };
  }
};

describe('strict UTF-8 decoding', () => {
  it('keeps a byte order mark that the default decoder would swallow', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]); // BOM + "{}"
    // The default decoder silently strips it, so the parser would never see it.
    expect(new TextDecoder().decode(bytes)).toBe('{}');
    expect(decodeStrictUtf8(bytes)).toBe('﻿{}');
  });

  it('fails on malformed bytes instead of substituting replacement characters', () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]); // {"a":"<bad>"}
    expect(new TextDecoder().decode(bytes)).toContain('�');
    expect(() => decodeStrictUtf8(bytes)).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_ENCODING' }));
  });

  it('decodes valid multi-byte content unchanged', async () => {
    await expect(readStrictTextBodyLimited(textRequest('{"title":"Tiếng Việt"}'))).resolves.toBe('{"title":"Tiếng Việt"}');
  });

  it('leaves the permissive reader alone for non-content routes', async () => {
    // Unrelated API envelopes keep their existing lenient decoding.
    await expect(readTextBodyLimited(rawRequest(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])))).resolves.toBe('{}');
  });
});

describe('strict JSON bodies reject what a client bypass would sneak past the editor', () => {
  it('accepts a well-formed object body', async () => {
    await expect(readStrictJsonBodyLimited(textRequest('{"kind":"course","id":"c"}'))).resolves.toEqual({ kind: 'course', id: 'c' });
  });

  it('rejects a duplicate property with a pointer to it', async () => {
    const result = await issues(textRequest('{"id":"a","id":"b"}'));
    expect(result).toMatchObject({ status: 400, code: 'INVALID_JSON', codes: ['E_JSON_DUPLICATE_KEY'] });
  });

  it.each([
    ['a byte order mark', '﻿{"a":1}', 'E_JSON_PARSE'],
    ['a code fence', '```json\n{"a":1}\n```', 'E_JSON_PARSE'],
    ['a trailing comma', '{"a":1,}', 'E_JSON_PARSE'],
    ['an overflowing number', '{"points":1e999}', 'E_JSON_NUMBER_RANGE'],
    ['an array root', '[{"a":1}]', 'E_JSON_ROOT_NOT_OBJECT'],
  ])('rejects %s', async (_label, body, code) => {
    const result = await issues(textRequest(body));
    expect(result.status).toBe(400);
    expect(result.codes).toContain(code);
  });

  it('rejects malformed UTF-8 bytes before parsing is even attempted', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x22, 0x7d]);
    await expect(readStrictJsonBodyLimited(rawRequest(bytes))).rejects.toMatchObject({ status: 400, code: 'INVALID_ENCODING' });
  });

  it('treats an empty body as {} only where the route says the body is optional', async () => {
    await expect(readStrictJsonBodyLimited(textRequest(''), { emptyAsObject: true })).resolves.toEqual({});
    await expect(readStrictJsonBodyLimited(textRequest(''))).rejects.toMatchObject({ status: 400 });
  });

  it('attributes diagnostics to the document the route is writing', async () => {
    const result = await issues(textRequest('{"id":"a","id":"b"}'), { ref: itemRef('manifest') });
    expect(result.codes).toEqual(['E_JSON_DUPLICATE_KEY']);
  });
});

describe('the wire budget and the content budget stay separate', () => {
  const body = (bytes: number) => `{"pad":"${'x'.repeat(bytes)}"}`;

  it('keeps the 2 MiB wire ceiling distinct from the 1 MiB document limit', () => {
    expect(MAX_WIRE_BODY_BYTES).toBe(MAX_ENVELOPE_BYTES);
    expect(MAX_DOCUMENT_BYTES).toBeLessThan(MAX_WIRE_BODY_BYTES);
  });

  it('rejects a single document over the document limit even though the wire allows it', async () => {
    // A size failure keeps a size status and a size code, with the diagnostic attached.
    const result = await issues(textRequest(body(1_100_000)));
    expect(result).toMatchObject({ status: 413, code: 'DOCUMENT_TOO_LARGE' });
    expect(result.codes).toContain('E_LIMIT_EXCEEDED');
  });

  it('keeps the nesting error code callers already handle', async () => {
    const nested = `{"a":${'['.repeat(70)}0${']'.repeat(70)}}`;
    const result = await issues(textRequest(nested));
    expect(result).toMatchObject({ status: 400, code: 'JSON_NESTING_TOO_DEEP' });
    expect(result.codes).toContain('E_LIMIT_EXCEEDED');
  });

  it('accepts the same payload on an envelope route', async () => {
    await expect(readStrictJsonBodyLimited(textRequest(body(1_100_000)), { envelope: true })).resolves.toMatchObject({ pad: expect.any(String) });
  });

  it('still stops an envelope over the envelope ceiling, at the wire', async () => {
    await expect(readStrictJsonBodyLimited(textRequest(body(MAX_ENVELOPE_BYTES)), { envelope: true }))
      .rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('honours a smaller budget on a public endpoint', async () => {
    await expect(readStrictJsonBodyLimited(textRequest(body(600_000)), { maxBytes: 512 * 1024 }))
      .rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('rejects an oversized declared content-length before reading the body', async () => {
    const request = new Request('http://localhost/strict', {
      method: 'POST',
      headers: { 'content-length': String(MAX_ENVELOPE_BYTES + 1) },
      body: '{}',
    });
    await expect(readStrictJsonBodyLimited(request)).rejects.toMatchObject({ status: 413 });
  });
});
