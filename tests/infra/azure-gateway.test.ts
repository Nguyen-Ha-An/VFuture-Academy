import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { gatewayClientOptions } from '../../src/lib/backend-gateway';
import { createGateway, initializeState } from '../../infra/azure/gateway/server.mjs';
import { Ledger } from '../../infra/azure/gateway/ledger.mjs';
import { MAX_DOCUMENT_BYTES, MAX_ENVELOPE_BYTES, decodeWorkspaceEnvelope } from '../../src/features/studio/content-transfer';

vi.mock('server-only', () => ({}));
import { grantStorageTransferUrl } from '../../src/features/storage-transfer/grants';

const SECRET = 'server-key-is-a-random-secret-at-least-32-bytes';
const GRANT_KEY = 'transfer-signing-secret-at-least-32-bytes';
const USER = 'a8aa4822-23b1-47ff-b3f9-120d7ae105bf';
const KEY_HEADERS = { 'x-vfuture-gateway-key': SECRET, authorization: 'Bearer valid-upstream-token', apikey: 'anon-key' };
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return `http://127.0.0.1:${address.port}`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
function signGrant(path: string, method = 'GET', maxBytes = 1024, overrides: Record<string, unknown> = {}) {
  const body = Buffer.from(JSON.stringify({ v: 1, aud: 'vfuture-storage-transfer', sub: USER, jti: randomUUID(), method, path, maxBytes, exp: Math.floor(Date.now() / 1000) + 600, ...overrides })).toString('base64url');
  return `${body}.${createHmac('sha256', GRANT_KEY).update(body).digest('base64url')}`;
}
function call(url: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: IncomingMessage['headers'] }>((resolve, reject) => {
    const req = request(url + path, { method: options.method ?? 'GET', headers: options.headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
function rawCall(url: string, path: string, headers: Record<string, string> = {}) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: new URL(url).port, path, headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    req.on('error', reject); req.end();
  });
}
async function fixture(options: Record<string, unknown> = {}, handler?: (req: IncomingMessage, res: ServerResponse) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'academy-gateway-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const stateDir = join(dir, 'state');
  const maintenanceFile = join(dir, 'maintenance.json');
  const writeMaintenance = (mode = 'normal', expiresAt = new Date(Date.now() + 900_000).toISOString()) => writeFileSync(maintenanceFile, JSON.stringify({ version: 1, mode, updatedAt: new Date().toISOString(), expiresAt }));
  writeMaintenance(); initializeState({ stateDir });
  const seen: Array<{ url: string; headers: IncomingMessage['headers']; body: string }> = [];
  const upstream = createServer((req, res) => {
    if (handler) return handler(req, res);
    const chunks: Buffer[] = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { seen.push({ url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() }); res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  });
  const upstreamUrl = await listen(upstream); cleanup.push(() => stop(upstream));
  const config = { authUrl: upstreamUrl, restUrl: upstreamUrl, storageUrl: upstreamUrl, gatewayKey: SECRET, transferGrantKey: GRANT_KEY, stateDir, maintenanceFile, ...options };
  const gateway = createGateway(config); const url = await listen(gateway); cleanup.push(() => stop(gateway));
  return { gateway, url, config, stateDir, maintenanceFile, writeMaintenance, seen };
}

describe('Azure gateway boundary', () => {
  it('fails startup closed for missing/short keys, public upstreams, missing or corrupt counters', async () => {
    const f = await fixture(); await stop(f.gateway);
    for (const patch of [{ gatewayKey: '' }, { transferGrantKey: 'short' }, { restUrl: 'https://attacker.example' }, { stateDir: join(f.stateDir, 'missing') }]) {
      expect(() => createGateway({ ...f.config, ...patch })).toThrow();
    }
    writeFileSync(join(f.stateDir, 'ledger.json'), '{}');
    expect(() => createGateway(f.config)).toThrow();
  });
  it('denies anonymous REST, admin, public objects and arbitrary proxy targets', async () => {
    const f = await fixture();
    for (const path of ['/rest/v1/profiles', '/auth/v1/admin/users', '/storage/v1/object/public/course/file', '/pg', '/?url=http://attacker.test']) {
      expect((await call(f.url, path, { headers: { authorization: 'Bearer forged', apikey: 'anon-key', origin: 'https://trusted.example' } })).status).toBe(403);
    }
    expect(f.seen).toHaveLength(0);
  });
  it('rejects ambiguous path encodings, duplicate query tokens and identity headers', async () => {
    const f = await fixture();
    for (const path of ['/auth//v1/token', '/auth/v1/../admin/users', '/auth/v1/%2e%2e/admin/users', '/auth/v1/%74oken', '/auth/v1/token%2f..', '/auth/v1/token\\admin', '/auth/v1/token?grant_type=password&grant_type=refresh_token']) {
      expect(await rawCall(f.url, path, KEY_HEADERS)).toBe(400);
    }
    expect(f.seen).toHaveLength(0);
  });
  it('keeps upstream authorization, strips server secret and untrusted identity, preserves upstream denial', async () => {
    let seen: IncomingMessage['headers'] = {};
    const f = await fixture({}, (req, res) => { seen = req.headers; res.writeHead(401); res.end('denied by upstream'); });
    const response = await call(f.url, '/rest/v1/profiles', { headers: { ...KEY_HEADERS, 'x-user-id': USER, 'x-forwarded-for': '1.2.3.4', 'x-jwt-claim-role': 'service_role', 'x-supabase-role': 'service_role', 'x-original-url': '/admin' } });
    expect(response.status).toBe(401); expect(response.body).toBe('denied by upstream');
    expect(seen.authorization).toBe('Bearer valid-upstream-token'); expect(seen.apikey).toBe('anon-key');
    for (const key of ['x-vfuture-gateway-key', 'x-user-id', 'x-forwarded-for', 'x-jwt-claim-role', 'x-supabase-role', 'x-original-url']) expect(seen[key]).toBeUndefined();
  });
  it('does not follow or return trusted server-lane redirects', async () => {
    const f = await fixture({}, (_req, res) => { res.writeHead(307, { location: 'http://attacker.example/rest/v1' }); res.end(); });
    const response = await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    expect(response.status).toBe(502); expect(response.headers.location).toBeUndefined();
  });
  it('preserves an upstream 304 because a cache response does not redirect credentials', async () => {
    const f = await fixture({}, (_req, res) => { res.writeHead(304, { etag: 'revision-1' }); res.end(); });
    const response = await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    expect(response.status).toBe(304); expect(response.headers.etag).toBe('revision-1');
  });
  it('allows only necessary auth method/path combinations and serves safe CORS preflight', async () => {
    const f = await fixture({ allowedOrigins: ['https://academy.example'] });
    expect((await call(f.url, '/auth/v1/token?grant_type=password', { method: 'POST', body: '{"email":"student@example.test"}' })).status).toBe(200);
    expect(f.seen[0].url).toBe('/token?grant_type=password');
    expect((await call(f.url, '/auth/v1/token')).status).toBe(403);
    const preflight = await call(f.url, '/auth/v1/token', { method: 'OPTIONS', headers: { origin: 'https://academy.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,apikey,content-type' } });
    expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBe('https://academy.example');
    expect((await call(f.url, '/auth/v1/token', { method: 'OPTIONS', headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST' } })).status).toBe(403);
  });
  it('rejects Go-compatible email aliases and non-object Auth JSON before forwarding', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) expect((await call(f.url, '/auth/v1/token?grant_type=password', { method: 'POST', body: '{"email":"victim@example.test"}' })).status).toBe(200);
    expect((await call(f.url, '/auth/v1/token?grant_type=password', { method: 'POST', body: '{"email":"victim@example.test"}' })).status).toBe(429);
    for (const body of ['{"Email":"victim@example.test"}', '{"email":"decoy@example.test","EMAIL":"victim@example.test"}', 'null', '[]', 'false', '"email"']) expect((await call(f.url, '/auth/v1/token?grant_type=password', { method: 'POST', body })).status).toBe(400);
    expect(f.seen).toHaveLength(5);
  });
  it('reserves email-change delivery and recipient cooldown in the durable email quota', async () => {
    const f = await fixture(); const options = { method: 'PUT', body: '{"email":"new-address@example.test"}', headers: { authorization: 'Bearer verified-upstream-user' } };
    expect((await call(f.url, '/auth/v1/user', options)).status).toBe(200);
    expect((await call(f.url, '/auth/v1/user', options)).status).toBe(429);
    expect(JSON.parse(readFileSync(join(f.stateDir, 'ledger.json'), 'utf8')).payload.email.monthly).toBe(2);
    expect(f.seen).toHaveLength(1);
  });
  it('does not admit a two-recipient email change when only one hourly delivery remains', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'academy-mail-budget-'));
    cleanup.push(() => rmSync(stateDir, { recursive: true, force: true }));
    const now = Date.now(); initializeState({ stateDir, now });
    const ledger = new Ledger(stateDir, {});
    for (let i = 0; i < 99; i++) expect(ledger.reserveEmail(`recipient-${i}`, now)).toBe(true);
    expect(ledger.reserveEmail('changed-recipient', now, 2)).toBe(false);
    expect(JSON.parse(readFileSync(join(stateDir, 'ledger.json'), 'utf8')).payload.email.hourly).toBe(99);
  });
  it('preserves critical response reserve when unauthenticated requests are rejected repeatedly', async () => {
    const f = await fixture({ limits: { monthlyWarningBytes: 1000, monthlyDiscretionaryBytes: 1500, monthlyBytes: 3000, responseChunkBytes: 1024, responseOverheadBytes: 128 } });
    expect((await call(f.url, '/rest/v1/rpc/new_discretionary_work', { method: 'POST', headers: KEY_HEADERS })).status).toBe(200);
    for (let i = 0; i < 20; i++) await call(f.url, '/not-a-service').catch(() => null);
    expect((await call(f.url, '/rest/v1/rpc/exam_save_active_answers', { method: 'POST', headers: KEY_HEADERS })).status).toBe(200);
  });
  it('admits critical Auth preflight and refresh after the discretionary byte ceiling', async () => {
    const f = await fixture({ allowedOrigins: ['https://academy.example'], limits: { monthlyWarningBytes: 1000, monthlyDiscretionaryBytes: 1152, monthlyBytes: 6000, responseChunkBytes: 1024, responseOverheadBytes: 128 } });
    expect((await call(f.url, '/rest/v1/rpc/new_discretionary_work', { method: 'POST', headers: KEY_HEADERS })).status).toBe(200);
    const path = '/auth/v1/token?grant_type=refresh_token';
    const preflight = await call(f.url, path, { method: 'OPTIONS', headers: { origin: 'https://academy.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,apikey,content-type' } });
    expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBe('https://academy.example');
    expect((await call(f.url, path, { method: 'POST', body: '{"refresh_token":"upstream-verifies-this"}', headers: { origin: 'https://academy.example' } })).status).toBe(200);
  });
  it('admits a 25-student school NAT auth burst without trusting forwarded IPs', async () => {
    const f = await fixture();
    const responses = await Promise.all(Array.from({ length: 25 }, (_, i) => call(f.url, '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: `student${i}@school.test` }), headers: { 'x-forwarded-for': '10.0.0.1' } })));
    expect(responses.every(r => r.status === 200)).toBe(true);
  });
  it('enforces global backend rates and returns Retry-After', async () => {
    const f = await fixture({ limits: { backendBurst: 2, backendRps: 0.001 } });
    expect((await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS })).status).toBe(200);
    expect((await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS })).status).toBe(200);
    const response = await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    expect(response.status).toBe(429); expect(response.headers['retry-after']).toBeDefined(); expect(f.seen).toHaveLength(2);
  });
  it('limits active requests, bounds its queue and cancels disconnected queued work', async () => {
    const pending: ServerResponse[] = [];
    const f = await fixture({ limits: { inflight: 1, queue: 1, queueTimeoutMs: 2000 } }, (_req, res) => pending.push(res));
    const active = call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    while (pending.length === 0) await new Promise(r => setTimeout(r, 5));
    const queued = request(f.url + '/rest/v1/profiles', { headers: KEY_HEADERS }); queued.on('error', () => {}); queued.end();
    await new Promise(r => setTimeout(r, 30));
    expect((await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS })).status).toBe(503);
    queued.destroy(); await new Promise(r => setTimeout(r, 30)); pending[0].end('ok'); expect((await active).status).toBe(200);
    await new Promise(r => setTimeout(r, 30)); expect(pending).toHaveLength(1);
  });
  it('uses a default 20-second ordinary deadline before the app 30-second timeout', async () => {
    let reached: () => void = () => {};
    const f = await fixture({}, () => reached());
    const atUpstream = new Promise<void>(resolve => { reached = resolve; });
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const active = call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS }).catch(() => null);
    try {
      await atUpstream;
      const deadline = timer.mock.calls.find(([, delay]) => delay === 20_000);
      expect(deadline).toBeDefined();
      (deadline![0] as () => void)();
      expect((await active)?.status).toBe(504);
    } finally { timer.mockRestore(); }
  });
  it('rejects malformed/chunked oversized bodies before forwarding oversize bytes', async () => {
    let bytes = 0;
    const f = await fixture({ limits: { requestBytes: 32 } }, (req, res) => { req.on('data', chunk => bytes += chunk.length); req.on('end', () => res.end('ok')); });
    const response = await call(f.url, '/rest/v1/profiles', { method: 'POST', headers: { ...KEY_HEADERS, 'transfer-encoding': 'chunked' }, body: 'x'.repeat(64) });
    expect(response.status).toBe(413); expect(bytes).toBeLessThanOrEqual(32);
  });
});

describe('installed Supabase SDK compatibility', () => {
  function sdk(url: string, trusted = true) {
    return createClient(url, 'ordinary-service-jwt', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...(trusted ? gatewayClientOptions({ SUPABASE_GATEWAY_KEY: SECRET }, url) : {}),
    });
  }
  it('preserves a valid 2 MiB workspace with actual SDK RPC wrappers while bounding REST at 4 MiB', async () => {
    const documents = Array.from({ length: 4 }, (_, index) => ({ schemaVersion: 1, kind: 'lesson', id: `lesson-${index}`, title: 'Lesson', blocks: Array.from({ length: 27 }, () => ({ type: 'code', language: 'python', code: 'x' })) }));
    const manifest = { ...JSON.parse(readFileSync(join(process.cwd(), 'docs/studio/content-schema/examples/course.json'), 'utf8')), modules: [{ id: 'module-1', title: 'Boundary', items: documents.map(item => ({ id: item.id, type: 'lesson' })) }] };
    const envelope = { manifest, items: Object.fromEntries(documents.map(item => [item.id, item])) };
    let remaining = MAX_ENVELOPE_BYTES - Buffer.byteLength(JSON.stringify(envelope));
    for (const item of documents) for (const block of item.blocks) { const extra = Math.min(19_999, remaining); block.code += 'x'.repeat(extra); remaining -= extra; }
    const text = JSON.stringify(envelope);
    expect(remaining).toBe(0); expect(Buffer.byteLength(text)).toBe(MAX_ENVELOPE_BYTES);
    expect(documents.every(item => Buffer.byteLength(JSON.stringify(item)) < MAX_DOCUMENT_BYTES)).toBe(true);
    expect(decodeWorkspaceEnvelope(text).ok).toBe(true);
    const args = { course_id: manifest.id, manifest, items: envelope.items, actor_id: USER, expected_updated_at: '2026-10-25T10:00:00.000Z', requested_base_version_id: null, set_base_version: false };
    const responseBody = JSON.stringify({ conflict: false, draft: { id: USER, course_id: manifest.id, manifest, items: envelope.items, updated_at: '2026-10-25T10:00:01.000Z' } });
    expect(Buffer.byteLength(JSON.stringify(args))).toBeGreaterThan(MAX_ENVELOPE_BYTES);
    expect(Buffer.byteLength(responseBody)).toBeGreaterThan(MAX_ENVELOPE_BYTES);
    let requestBytes = 0; let requests = 0;
    const f = await fixture({}, (req, res) => {
      requests++;
      if (req.url === '/rpc/oversized_reply') { req.resume(); res.setHeader('content-length', String(4 * 1024 * 1024 + 1)); res.end('x'); return; }
      req.on('data', chunk => requestBytes += chunk.length);
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.setHeader('content-length', String(Buffer.byteLength(responseBody))); res.end(responseBody); });
    });
    const result = await sdk(f.url).rpc('studio_save_draft_workspace', args);
    expect(result.error).toBeNull(); expect(result.data?.draft.course_id).toBe(manifest.id);
    expect(Buffer.byteLength(JSON.stringify(result.data))).toBe(Buffer.byteLength(responseBody));
    expect(requestBytes).toBe(Buffer.byteLength(JSON.stringify(args)));
    expect((await sdk(f.url).rpc('studio_save_draft_workspace', { oversized: 'x'.repeat(4 * 1024 * 1024) })).error).not.toBeNull();
    expect(requests).toBe(1);
    expect((await sdk(f.url).rpc('oversized_reply', {})).status).toBe(502);
    const overBusinessLimit = text.replace('"code":"x', '"code":"xx');
    expect(Buffer.byteLength(overBusinessLimit)).toBe(MAX_ENVELOPE_BYTES + 1);
    expect(decodeWorkspaceEnvelope(overBusinessLimit).ok).toBe(false);
  }, 15_000);
  it('forwards SDK object downloads/uploads with normal credentials and forbids the same public routes', async () => {
    const seen: Array<{ method: string; path: string; headers: IncomingMessage['headers'] }> = [];
    const f = await fixture({}, (req, res) => {
      seen.push({ method: req.method!, path: req.url!, headers: req.headers });
      req.resume(); req.on('end', () => {
        if (req.method === 'GET') { res.setHeader('content-type', 'application/octet-stream'); res.end('stored-file'); }
        else { res.setHeader('content-type', 'application/json'); res.end('{"Id":"object-id","Key":"certificates/result.pdf"}'); }
      });
    });
    const client = sdk(f.url);
    const downloaded = await client.storage.from('notebooks').download('pending/user/file.csv');
    expect(downloaded.error).toBeNull(); expect(await downloaded.data!.text()).toBe('stored-file');
    const uploaded = await client.storage.from('certificates').upload('result.pdf', new Uint8Array([1, 2, 3]), { contentType: 'application/pdf', cacheControl: '600', upsert: false });
    expect(uploaded.error).toBeNull(); expect(uploaded.data?.path).toBe('result.pdf');
    expect(seen.map(r => [r.method, r.path])).toEqual([['GET', '/object/notebooks/pending/user/file.csv'], ['POST', '/object/certificates/result.pdf']]);
    for (const item of seen) { expect(item.headers.authorization).toBe('Bearer ordinary-service-jwt'); expect(item.headers.apikey).toBe('ordinary-service-jwt'); expect(item.headers['x-vfuture-gateway-key']).toBeUndefined(); }
    expect(seen[1].headers['cache-control']).toBe('max-age=600');
    expect((await sdk(f.url, false).storage.from('notebooks').download('pending/user/file.csv')).error).not.toBeNull();
    expect((await sdk(f.url, false).storage.from('certificates').upload('result.pdf', new Uint8Array([1]))).error).not.toBeNull();
    expect((await call(f.url, '/storage/v1/object/authenticated/notebooks/pending/user/file.csv', { headers: KEY_HEADERS })).status).toBe(200);
    expect((await call(f.url, '/storage/v1/object/authenticated/notebooks/pending/user/file.csv')).status).toBe(403);
  });
  it('preserves upstream Storage denial for a server transport key without upstream permission', async () => {
    const f = await fixture({}, (_req, res) => { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"message":"Storage permission denied"}'); });
    const response = await sdk(f.url).storage.from('notebooks').download('pending/user/file.csv');
    expect(response.error).not.toBeNull();
    const original = (response.error as unknown as { originalError: Response }).originalError;
    expect(original.status).toBe(403); expect(await original.text()).toContain('Storage permission denied');
    expect(response.data).toBeNull();
  });
  it('forwards repeated SDK PostgREST range, id and logical filters only on the trusted REST lane', async () => {
    let query: URLSearchParams | undefined;
    const f = await fixture({}, (req, res) => { query = new URL(req.url!, 'http://upstream').searchParams; req.resume(); res.setHeader('content-type', 'application/json'); res.end('[]'); });
    const result = await sdk(f.url).from('grades').select('id').gte('graded_at', '2026-01-01').lt('graded_at', '2026-02-01').gte('id', 1).lt('id', 10).or('status.eq.complete,status.eq.pending').or('score.gt.1,score.is.null');
    expect(result.error).toBeNull(); expect(result.data).toEqual([]);
    expect(query?.getAll('graded_at')).toEqual(['gte.2026-01-01', 'lt.2026-02-01']);
    expect(query?.getAll('id')).toEqual(['gte.1', 'lt.10']);
    expect(query?.getAll('or')).toEqual(['(status.eq.complete,status.eq.pending)', '(score.gt.1,score.is.null)']);
    expect((await sdk(f.url, false).from('grades').select('id').gte('graded_at', '2026-01-01').lt('graded_at', '2026-02-01')).error).not.toBeNull();
    for (const path of ['/auth/v1/token?grant_type=password&grant_type=refresh_token', '/storage/v1/object/sign/bucket/file?token=one&token=two', '/rest/v1/grades?select=id&select=private', '/rest/v1/grades?gateway_grant=a&gateway_grant=b']) expect(await rawCall(f.url, path, KEY_HEADERS)).toBe(400);
  });
  it.each([5, 10, 50])('streams a %i MiB SDK download and upload with distinct bounded Storage ceilings', async (mib) => {
    const size = mib * 1024 * 1024; let uploadedBytes = 0;
    const f = await fixture({}, (req, res) => {
      if (req.method === 'GET') {
        req.resume(); res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-length', String(size));
        const chunk = Buffer.alloc(64 * 1024, 7); let remaining = size;
        const write = () => { while (remaining > 0) { const length = Math.min(chunk.length, remaining); remaining -= length; if (!res.write(chunk.subarray(0, length))) { res.once('drain', write); return; } } res.end(); }; write();
      } else {
        req.on('data', chunk => uploadedBytes += chunk.length);
        req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{"Id":"object-id","Key":"media/ready/file.bin"}'); });
      }
    });
    const downloaded = await sdk(f.url).storage.from('media').download('pending/file.bin');
    expect(downloaded.error).toBeNull(); expect(downloaded.data?.size).toBe(size);
    const uploaded = await sdk(f.url).storage.from('media').upload('ready/file.bin', Buffer.alloc(size, 7), { contentType: 'application/octet-stream', upsert: false });
    expect(uploaded.error).toBeNull(); expect(uploadedBytes).toBe(size);
    const ledger = JSON.parse(readFileSync(join(f.stateDir, 'ledger.json'), 'utf8')).payload;
    expect(ledger.outbound).toBeGreaterThan(size); expect(ledger.downloadBytes).toBeGreaterThanOrEqual(size);
  }, 30_000);
  it('accepts the bounded multipart framing of a maximum-size SDK Blob upload', async () => {
    const size = 50 * 1024 * 1024; let received = 0; let type = '';
    const f = await fixture({}, (req, res) => { type = req.headers['content-type'] ?? ''; req.on('data', chunk => received += chunk.length); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end('{"Id":"object-id","Key":"media/file.bin"}'); }); });
    const result = await sdk(f.url).storage.from('media').upload('file.bin', new Blob([Buffer.alloc(size)], { type: 'application/octet-stream' }), { upsert: false });
    expect(result.error).toBeNull(); expect(type).toMatch(/^multipart\/form-data; boundary=/);
    expect(received).toBeGreaterThan(size); expect(received).toBeLessThanOrEqual(size + 64 * 1024);
  }, 30_000);
  it('stops trusted server downloads at the site daily ceiling before forwarding oversized output', async () => {
    const f = await fixture({ limits: { siteDailyDownloadBytes: 32 } }, (req, res) => { req.resume(); res.end('x'.repeat(64)); });
    const result = await sdk(f.url).storage.from('notebooks').download('pending/file.csv');
    expect(result.error).not.toBeNull(); expect(result.data).toBeNull();
    expect(JSON.parse(readFileSync(join(f.stateDir, 'ledger.json'), 'utf8')).payload.downloadBytes).toBe(0);
  });
  it('bounds trusted object streams and shares global transfer slots', async () => {
    const pending: ServerResponse[] = [];
    const f = await fixture({ limits: { downloads: 1, uploadBytes: 32, storageResponseBytes: 32 } }, (req, res) => { req.resume(); pending.push(res); });
    const active = sdk(f.url).storage.from('notebooks').download('file.csv').then(value => value);
    while (pending.length === 0) await new Promise(resolve => setTimeout(resolve, 5));
    const second = await sdk(f.url).storage.from('notebooks').download('file2.csv'); expect(second.error).not.toBeNull();
    pending[0].end('small'); expect((await active).error).toBeNull();
    const oversize = await sdk(f.url).storage.from('media').upload('file.bin', Buffer.alloc(33)); expect(oversize.error).not.toBeNull();
    expect(pending).toHaveLength(1);
  });
});

describe('persistent transfer admission and maintenance', () => {
  it('rejects missing, forged, mismatched and expired storage grants without trusting JWT claims', async () => {
    const f = await fixture(); const path = '/storage/v1/object/sign/course/object.pdf';
    const valid = signGrant(path);
    for (const grant of ['', valid.slice(0, -3) + 'bad', signGrant(path, 'GET', 1024, { exp: 1 }), signGrant(path, 'GET', 1024, { sub: '../../admin' }), signGrant(path + 'x')]) {
      expect((await call(f.url, `${path}?token=supabase-token&gateway_grant=${grant}`, { headers: { authorization: 'Bearer ey.fake.admin', 'x-user-id': USER } })).status).toBe(403);
    }
    expect(f.seen).toHaveLength(0);
  });
  it('forwards downloads with bounded retries, allows HEAD and persists exhausted grants across restart', async () => {
    const f = await fixture(); const path = '/storage/v1/object/sign/course/object.pdf'; const grant = signGrant(path);
    expect((await call(f.url, `${path}?token=supabase-token&gateway_grant=${grant}`)).status).toBe(200);
    expect(f.seen[0].url).toBe('/object/sign/course/object.pdf?token=supabase-token');
    expect((await call(f.url, `${path}?token=supabase-token&gateway_grant=${grant}`, { method: 'HEAD' })).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await call(f.url, `${path}?token=supabase-token&gateway_grant=${grant}`)).status).toBe(200);
    expect((await call(f.url, `${path}?token=supabase-token&gateway_grant=${grant}`)).status).toBe(409);
    await stop(f.gateway);
    const restarted = createGateway(f.config); const url = await listen(restarted); cleanup.push(() => stop(restarted));
    expect((await call(url, `${path}?token=supabase-token&gateway_grant=${grant}`)).status).toBe(409);
  });
  it('enforces authenticated per-user and site daily byte reservations persistently', async () => {
    const f = await fixture({ limits: { userDailyDownloadBytes: 32, siteDailyDownloadBytes: 50 } }); const path = '/storage/v1/object/sign/course/file';
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 24)}`)).status).toBe(200);
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 24)}`)).status).toBe(429);
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 24, { sub: 'f28f32dd-3df7-4ccb-967d-9fbfe5c06472' })}`)).status).toBe(200);
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 24, { sub: '3df210f1-e7f8-4b31-b0ce-9d511405dd57' })}`)).status).toBe(429);
  });
  it('accepts the real application helper grant including an encoded object name', async () => {
    const f = await fixture();
    const url = grantStorageTransferUrl('https://storage.example/storage/v1/object/sign/course/file%20name.pdf?token=upstream', { subject: USER, method: 'GET', bucket: 'course', path: 'file name.pdf', maxBytes: 1024 }, { SUPABASE_GATEWAY_KEY: SECRET, SUPABASE_TRANSFER_GRANT_KEY: GRANT_KEY, NEXT_PUBLIC_SUPABASE_URL: 'https://storage.example' });
    const parsed = new URL(url);
    expect((await call(f.url, parsed.pathname + parsed.search)).status).toBe(200);
  });
  it('refuses a second counter writer and retains single-use uploads after a restart', async () => {
    const f = await fixture();
    expect(() => createGateway(f.config)).toThrow();
    const path = '/storage/v1/object/upload/sign/submissions/file'; const grant = signGrant(path, 'PUT', 32);
    expect((await call(f.url, `${path}?token=t&gateway_grant=${grant}`, { method: 'PUT', body: 'small' })).status).toBe(200);
    await stop(f.gateway); const restarted = createGateway(f.config); const url = await listen(restarted); cleanup.push(() => stop(restarted));
    expect((await call(url, `${path}?token=t&gateway_grant=${grant}`, { method: 'PUT', body: 'small' })).status).toBe(409);
  });
  it('times out stalled auth bodies so a slow client cannot hold an admission slot', async () => {
    const f = await fixture({ limits: { inflight: 1, requestTimeoutMs: 80 } });
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(f.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.write('{');
    });
    expect(status).toBe(504);
    expect((await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS })).status).toBe(200);
  });
  it('persists recipient cooldown without storing email addresses or secret grants', async () => {
    const f = await fixture(); const requestOptions = { method: 'POST', body: '{"email":"student@example.test"}' };
    expect((await call(f.url, '/auth/v1/recover', requestOptions)).status).toBe(200);
    await stop(f.gateway); const restarted = createGateway(f.config); const url = await listen(restarted); cleanup.push(() => stop(restarted));
    expect((await call(url, '/auth/v1/recover', requestOptions)).status).toBe(429);
    expect(readFileSync(join(f.stateDir, 'ledger.json'), 'utf8')).not.toContain('student@example.test');
  });
  it('allows anonymous signed public downloads, forbids anonymous uploads and honors canonical encoded names', async () => {
    const f = await fixture(); const path = '/storage/v1/object/sign/course/file%20name.pdf';
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 1024, { sub: 'public' })}`)).status).toBe(200);
    const upload = '/storage/v1/object/upload/sign/course/file%20name.pdf';
    expect((await call(f.url, `${upload}?token=t&gateway_grant=${signGrant(upload, 'PUT', 1024, { sub: 'public' })}`, { method: 'PUT', body: 'a' })).status).toBe(403);
    for (const encoded of ['file%2520name.pdf', '%2Fadmin', '%5cadmin', '%2e%2e']) expect(await rawCall(f.url, `/storage/v1/object/sign/course/${encoded}?token=t`, KEY_HEADERS)).toBe(400);
  });
  it('only accepts an overwritten client IP from the configured proxy socket', async () => {
    const f = await fixture({ trustedProxyIp: '127.0.0.1' });
    expect((await call(f.url, '/auth/v1/user', { headers: { 'x-forwarded-for': '203.0.113.2' } })).status).toBe(200);
    expect(f.seen[0].headers['x-forwarded-for']).toBe('203.0.113.2');
    expect((await call(f.url, '/auth/v1/user', { headers: { 'x-forwarded-for': '203.0.113.2, 1.1.1.1' } })).status).toBe(200);
    expect(f.seen[1].headers['x-forwarded-for']).toBeUndefined();
  });
  it('publishes counters without including identities or secrets', async () => {
    const f = await fixture();
    await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    await stop(f.gateway);
    const telemetry = JSON.parse(readFileSync(join(f.stateDir, 'telemetry.json'), 'utf8'));
    expect(telemetry.monthlyOutboundBytes).toBeGreaterThan(0); expect(telemetry.activeRequests).toBe(0);
    expect(JSON.stringify(telemetry)).not.toContain(SECRET); expect(JSON.stringify(telemetry)).not.toContain(USER);
  });
  it('advances persistent telemetry sequence even when no request bytes change', async () => {
    const f = await fixture();
    const first = JSON.parse(readFileSync(join(f.stateDir, 'telemetry.json'), 'utf8'));
    await stop(f.gateway);
    const second = JSON.parse(readFileSync(join(f.stateDir, 'telemetry.json'), 'utf8'));
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(second.monthlyOutboundBytes).toBe(first.monthlyOutboundBytes);
    const restarted = createGateway(f.config); await listen(restarted); cleanup.push(() => stop(restarted));
    const third = JSON.parse(readFileSync(join(f.stateDir, 'telemetry.json'), 'utf8'));
    expect(third.sequence).toBeGreaterThan(second.sequence);
  });
  it('uses one quota identity for differently cased UUID spellings', async () => {
    const f = await fixture({ limits: { userDailyDownloadBytes: 32 } }); const path = '/storage/v1/object/sign/course/file';
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 24)}`)).status).toBe(200);
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 24, { sub: USER.toUpperCase() })}`)).status).toBe(429);
  });
  it('limits one upload per verified user and four globally', async () => {
    const pending: ServerResponse[] = [];
    const f = await fixture({}, (req, res) => { req.resume(); pending.push(res); });
    const path = '/storage/v1/object/upload/sign/submissions/file';
    const transfers: Array<Promise<unknown>> = [];
    for (let i = 0; i < 4; i++) {
      const sub = i ? `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` : USER;
      transfers.push(call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'PUT', 32, { sub })}`, { method: 'PUT', body: 'small' }));
      while (pending.length <= i) await new Promise(r => setTimeout(r, 5));
    }
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'PUT', 32)}`, { method: 'PUT', body: 'small' })).status).toBe(429);
    for (const res of pending) res.end('ok'); await Promise.all(transfers);
  });
  it('stops oversize upstream streams and releases transfer slots after client aborts', async () => {
    const f = await fixture({ limits: { downloads: 1 } }, (_req, res) => { res.writeHead(200); res.write('x'.repeat(128)); setTimeout(() => res.end('later'), 50).unref(); });
    const path = '/storage/v1/object/sign/course/file';
    await expect(call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 16)}`)).rejects.toThrow();
    await new Promise(r => setTimeout(r, 20));
    const response = await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path, 'GET', 1024)}`);
    expect(response.status).toBe(200);
  });
  it('preserves critical exam reads/auth/writes while discretionary work is stopped', async () => {
    const f = await fixture(); f.writeMaintenance('discretionary-stop');
    for (const [method, path] of [['POST', '/rest/v1/rpc/exam_save_active_answers'], ['POST', '/rest/v1/rpc/exam_finalize_attempt'], ['POST', '/rest/v1/rpc/rate_limit'], ['POST', '/rest/v1/rpc/authorization_actor'], ['GET', '/rest/v1/profiles'], ['POST', '/auth/v1/token?grant_type=refresh_token']]) {
      expect((await call(f.url, path, { method, headers: KEY_HEADERS })).status).toBe(200);
    }
    for (const path of ['/rest/v1/rpc/exam_start_attempt', '/auth/v1/signup', '/auth/v1/recover']) expect((await call(f.url, path, { method: 'POST', headers: KEY_HEADERS })).status).toBe(503);
    const path = '/storage/v1/object/sign/course/file';
    expect((await call(f.url, `${path}?token=t&gateway_grant=${signGrant(path)}`)).status).toBe(503);
  });
  it('admits required post-submit grade and learning receipts but defers certificate jobs', async () => {
    const f = await fixture(); f.writeMaintenance('discretionary-stop');
    for (const path of ['/rest/v1/exam_grades', '/rest/v1/skill_evidence', '/rest/v1/xp_events', '/rest/v1/lesson_progress', '/rest/v1/rpc/xp_update_streak', '/rest/v1/rpc/learner_complete_course']) {
      expect((await call(f.url, path, { method: 'POST', headers: KEY_HEADERS, body: '{}' })).status).toBe(200);
      expect((await call(f.url, path, { method: 'POST', body: '{}' })).status).toBe(403);
    }
    for (const path of ['/rest/v1/rpc/learner_claim_completion_effect', '/rest/v1/analytics_events', '/rest/v1/certificates', '/rest/v1/profiles']) expect((await call(f.url, path, { method: 'POST', headers: KEY_HEADERS, body: '{}' })).status).toBe(503);
  });
  it('rechecks drain before queued work reaches a backend', async () => {
    const pending: ServerResponse[] = [];
    const f = await fixture({ limits: { inflight: 1 } }, (_req, res) => pending.push(res));
    const active = call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    while (!pending.length) await new Promise(r => setTimeout(r, 5));
    const queued = call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS });
    await new Promise(r => setTimeout(r, 20)); f.writeMaintenance('drain'); pending[0].end('ok');
    expect((await active).status).toBe(200); expect((await queued).status).toBe(503); expect(pending).toHaveLength(1);
  });
  it('enforces the financial grace deadline locally without waiting for another control poll', async () => {
    const f = await fixture(); const now = Date.now();
    const control = { version: 1, mode: 'discretionary-stop', drainReason: 'financial', financialRequestedAt: new Date(now - 60_000).toISOString(), drainAfter: new Date(now + 60_000).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString() };
    writeFileSync(f.maintenanceFile, JSON.stringify(control));
    expect((await call(f.url, '/rest/v1/rpc/exam_save_active_answers', { method: 'POST', headers: KEY_HEADERS })).status).toBe(200);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    try {
      expect((await call(f.url, '/rest/v1/rpc/exam_save_active_answers', { method: 'POST', headers: KEY_HEADERS })).status).toBe(503);
      writeFileSync(f.maintenanceFile, JSON.stringify({ ...control, updatedAt: new Date(now + 60_000).toISOString(), expiresAt: new Date(now + 960_000).toISOString() }));
      expect((await call(f.url, '/rest/v1/rpc/exam_finalize_attempt', { method: 'POST', headers: KEY_HEADERS })).status).toBe(503);
    } finally { clock.mockRestore(); }
  });
  it('fails closed for incomplete, invalid or extended financial grace controls', async () => {
    const f = await fixture(); const now = Date.now();
    const base = { version: 1, mode: 'discretionary-stop', drainReason: 'financial', financialRequestedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString() };
    for (const patch of [{}, { drainAfter: 'bad' }, { drainAfter: new Date(now + 120_001).toISOString() }, { drainAfter: new Date(now).toISOString() }, { drainAfter: new Date(now + 60_000).toISOString(), drainReason: 'scheduled-backup' }]) {
      writeFileSync(f.maintenanceFile, JSON.stringify({ ...base, ...patch }));
      expect((await call(f.url, '/rest/v1/rpc/exam_save_active_answers', { method: 'POST', headers: KEY_HEADERS })).status).toBe(503);
    }
  });
  it('fails closed on missing/stale/corrupt maintenance and drain denies new work', async () => {
    const f = await fixture();
    for (const content of ['{}', '{', JSON.stringify({ version: 1, mode: 'normal', updatedAt: new Date().toISOString(), expiresAt: '2020-01-01T00:00:00.000Z' })]) {
      writeFileSync(f.maintenanceFile, content); expect((await call(f.url, '/rest/v1/profiles', { headers: KEY_HEADERS })).status).toBe(503);
    }
    f.writeMaintenance('drain'); expect((await call(f.url, '/rest/v1/rpc/exam_save_active_answers', { method: 'POST', headers: KEY_HEADERS })).status).toBe(503);
  });
  it('reserves durable monthly bytes before forwarding and uses the critical reserve only for allowed work', async () => {
    const f = await fixture({ limits: { monthlyWarningBytes: 4000, monthlyDiscretionaryBytes: 5000, monthlyBytes: 10000, responseChunkBytes: 1024, responseOverheadBytes: 128 } });
    for (let i = 0; i < 4; i++) expect((await call(f.url, '/rest/v1/rpc/new_discretionary_work', { method: 'POST', headers: KEY_HEADERS })).status).toBe(200);
    expect((await call(f.url, '/rest/v1/rpc/new_discretionary_work', { method: 'POST', headers: KEY_HEADERS })).status).toBe(503);
    expect((await call(f.url, '/rest/v1/rpc/exam_save_active_answers', { method: 'POST', headers: KEY_HEADERS })).status).toBe(200);
    const disk = readFileSync(join(f.stateDir, 'ledger.json'), 'utf8'); expect(disk).not.toContain(SECRET); expect(disk).not.toContain(GRANT_KEY);
    await stop(f.gateway); const restarted = createGateway(f.config); const url = await listen(restarted); cleanup.push(() => stop(restarted));
    await expect(call(url, '/rest/v1/rpc/new_discretionary_work', { method: 'POST', headers: KEY_HEADERS })).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(f.stateDir, 'ledger.json'), 'utf8')).payload.outbound).toBe(JSON.parse(disk).payload.outbound);
  });
});
