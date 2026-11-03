import { afterEach,expect,it,vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/service-client';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('separates data JWTs from retained Storage service credentials',async()=>{
  vi.stubEnv('ACADEMY_BACKEND','azure');vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND','azure');
  vi.stubEnv('AZURE_POSTGREST_URL','https://data.example.test');vi.stubEnv('AZURE_POSTGREST_JWT_SECRET','a'.repeat(40));
  vi.stubEnv('SUPABASE_STORAGE_URL','https://storage.example.test');vi.stubEnv('SUPABASE_STORAGE_SERVICE_ROLE_KEY','storage-only-secret');
  const fetcher=vi.fn<typeof fetch>(async(input)=>new Response(JSON.stringify(String(input).includes('/rest/')?[]:[]),{headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetcher);
  const db=createServiceClient('https://legacy.example.test','legacy-data-secret');
  await db.from('profiles').select('id');
  await db.storage.from('media').createSignedUrl('private.png',60);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://data.example.test/profiles?select=id');
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).not.toContain('storage-only-secret');
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer storage-only-secret');
  expect(String(fetcher.mock.calls[1][0])).toContain('https://storage.example.test/storage/v1/object/sign/');
  expect((await db.auth.admin.oauth.getClient('x')).error?.status).toBe(501);
});
