import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { grantStorageTransferUrl, type StorageTransfer } from '@/features/storage-transfer/grants';

const key = 'transfer-secret-'.repeat(4);
const source = { SUPABASE_GATEWAY_KEY: 'server-gateway-key', SUPABASE_TRANSFER_GRANT_KEY: key, NEXT_PUBLIC_SUPABASE_URL: 'https://storage.example' };
const url = 'https://storage.example/storage/v1/object/sign/media/lessons/example.pdf?token=ordinary-supabase-token&download=example.pdf';
const transfer: StorageTransfer = { subject: '11111111-1111-4111-8111-111111111111', method: 'GET', bucket: 'media', path: 'lessons/example.pdf', maxBytes: 1234 };
function unpack(value: string) {
  const grant = new URL(value).searchParams.get('gateway_grant');
  expect(grant).toBeTruthy();
  const [payload, signature] = grant!.split('.');
  return { payload, signature, claims: JSON.parse(Buffer.from(payload, 'base64url').toString()) };
}
afterEach(() => vi.useRealTimers());
describe('storage transfer gateway grants', () => {
  it('preserves hosted Supabase URLs exactly when the gateway is disabled', () => {
    expect(grantStorageTransferUrl(url, transfer, {})).toBe(url);
  });
  it('binds a verifiable signature to viewer, exact path, byte ceiling and bounded expiry without replacing the Supabase token', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
    const result = grantStorageTransferUrl(url, { ...transfer, expiresIn: 3600 }, source);
    const { payload, signature, claims } = unpack(result);
    expect(claims).toEqual({ v: 1, aud: 'vfuture-storage-transfer', sub: transfer.subject, method: 'GET', path: '/storage/v1/object/sign/media/lessons/example.pdf', maxBytes: 1234, exp: 1792887300, jti: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/) });
    expect(signature).toBe(createHmac('sha256', key).update(payload).digest('base64url'));
    expect(new URL(result).searchParams.get('token')).toBe('ordinary-supabase-token');
    expect(new URL(result).searchParams.get('download')).toBe('example.pdf');
    const tampered = Buffer.from(JSON.stringify({ ...claims, maxBytes: 999999 })).toString('base64url');
    expect(signature).not.toBe(createHmac('sha256', key).update(tampered).digest('base64url'));
    expect(result).not.toContain(key); expect(result).not.toContain(source.SUPABASE_GATEWAY_KEY);
    expect(unpack(grantStorageTransferUrl(url, transfer, source)).claims.jti).not.toBe(claims.jti);
  });
  it('permits public downloads but never public uploads', () => {
    expect(unpack(grantStorageTransferUrl(url, { ...transfer, subject: 'public' }, source)).claims.sub).toBe('public');
    expect(() => grantStorageTransferUrl(url.replace('/object/sign/', '/object/upload/sign/'), { ...transfer, subject: 'public', method: 'PUT' }, source)).toThrow();
  });
  it('signs private uploads with their validated reservation bytes', () => {
    const result = grantStorageTransferUrl(url.replace('/object/sign/', '/object/upload/sign/'), { ...transfer, method: 'PUT' }, source);
    expect(unpack(result).claims).toMatchObject({ method: 'PUT', sub: transfer.subject, maxBytes: 1234, path: '/storage/v1/object/upload/sign/media/lessons/example.pdf' });
  });
  it.each([undefined, '', 'short'])('fails closed for a missing or weak transfer key without leaking credentials', (secret) => {
    expect(() => grantStorageTransferUrl(url, transfer, { ...source, SUPABASE_TRANSFER_GRANT_KEY: secret })).toThrow(/SUPABASE_TRANSFER_GRANT_KEY/);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, '1234'])('rejects an invalid byte allowance %s', (maxBytes) => {
    expect(() => grantStorageTransferUrl(url, { ...transfer, maxBytes }, source)).toThrow();
  });
  it.each([
    url.replace('storage.example', 'attacker.example'),
    url.replace('https://', 'https://user:secret@'),
    url.replace('https://', 'http://'),
    url.replace('lessons/example.pdf', 'other/example.pdf'),
    url.replace('lessons/example.pdf', 'lessons/../lessons/example.pdf'),
    url.replace('lessons/example.pdf', 'lessons/%2e%2e/lessons/example.pdf'),
    url.replace('lessons/example.pdf', 'lessons%2Fexample.pdf'),
    url.replace('lessons/example.pdf', 'lessons//example.pdf'),
    url + '#fragment', url + '&gateway_grant=forged', url + '&token=another',
  ])('rejects origin, path or query ambiguity: %s', (signedUrl) => {
    expect(() => grantStorageTransferUrl(signedUrl, transfer, source)).toThrow();
  });
  it.each(['', 'owner-id', 'public '])('rejects an invalid private subject %s', (subject) => {
    expect(() => grantStorageTransferUrl(url, { ...transfer, subject }, source)).toThrow();
  });
  it('rejects download grants beyond the gateway daily ceiling before returning a dead URL', () => {
    expect(() => grantStorageTransferUrl(url, { ...transfer, maxBytes: 100 * 1024 * 1024 + 1 }, source)).toThrow();
    expect(unpack(grantStorageTransferUrl(url, { ...transfer, maxBytes: 100 * 1024 * 1024 }, source)).claims.maxBytes).toBe(104857600);
  });
  it('allows canonical encoded UTF-8 and spaces while rejecting oversized uploads', () => {
    const signed = url.replace('lessons/example.pdf', 'lessons/B%C3%A0i%201.pdf');
    expect(unpack(grantStorageTransferUrl(signed, { ...transfer, path: 'lessons/Bài 1.pdf' }, source)).claims.path).toBe('/storage/v1/object/sign/media/lessons/B%C3%A0i%201.pdf');
    expect(() => grantStorageTransferUrl(url.replace('/object/sign/', '/object/upload/sign/'), { ...transfer, method: 'PUT', maxBytes: 50 * 1024 * 1024 + 1 }, source)).toThrow();
  });

});
