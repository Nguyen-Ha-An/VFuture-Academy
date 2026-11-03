import { describe, expect, it, vi } from 'vitest';
import { createAzureDataClient, signDatabaseToken } from '@/lib/database/azure-client';

const source = { AZURE_POSTGREST_URL: 'https://data.example.test', AZURE_POSTGREST_JWT_SECRET: 's'.repeat(40) };
const userId = '11111111-1111-4111-8111-111111111111';
describe('Azure database boundary', () => {
  it('signs a short fixed-role token tied to the Academy UUID', () => {
    const token = signDatabaseToken('authenticated', userId, source, 1000);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ role: 'authenticated', sub: userId, aud: 'academy-data', iss: 'academy-server', iat: 1000, exp: 1060 });
    expect(() => signDatabaseToken('owner' as never, userId, source)).toThrow();
    expect(() => signDatabaseToken('authenticated', 'external-provider-subject', source)).toThrow();
    expect(() => signDatabaseToken('authenticated', undefined, source)).toThrow();
  });
  it('uses native PostgREST paths, fresh bearer tokens, and no Supabase auth endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ id: userId }]), { headers: { 'content-type': 'application/json' } }));
    const client = createAzureDataClient('authenticated', userId, source, fetcher);
    expect((await client.from('profiles').select('id')).data).toEqual([{ id: userId }]);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://data.example.test/profiles?select=id');
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toMatch(/^Bearer /);
    expect(headers.get('apikey')).toBeNull();
    expect(() => client.auth.getSession()).toThrow();
  });
  it('rejects plaintext and credential-bearing endpoints', () => {
    expect(() => createAzureDataClient('service_role', undefined, { ...source, AZURE_POSTGREST_URL: 'http://data.example.test' })).toThrow();
    expect(() => createAzureDataClient('service_role', undefined, { ...source, AZURE_POSTGREST_URL: 'https://secret@data.example.test' })).toThrow();
  });
});
