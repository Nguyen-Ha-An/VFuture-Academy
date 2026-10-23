import { describe, expect, it, vi } from 'vitest';

import {
  assertStagingStorageTarget,
  createStagingStorageApi,
  readStagingStorageEnvironment,
  setupStagingStorage,
  type StagingStorageApi,
} from '../../scripts/setup-staging-storage';

const privateBuckets = [
  { id: 'media', public: false },
  { id: 'submissions', public: false },
  { id: 'certificates', public: false },
];

function api(buckets = privateBuckets): StagingStorageApi {
  return { listBuckets: vi.fn(async () => buckets), createPrivateBucket: vi.fn(async () => undefined) };
}

describe('staging Storage setup', () => {
  it('requires the exact hosted API hostname for SEED_DEV_PROJECT_REF and has no production override', () => {
    expect(() => assertStagingStorageTarget('https://stage-ref.supabase.co', 'stage-ref')).not.toThrow();
    expect(() => assertStagingStorageTarget('https://other-ref.supabase.co', 'stage-ref')).toThrow('exact hosted');
    expect(() => readStagingStorageEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: 'https://production-ref.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SEED_DEV_PROJECT_REF: 'stage-ref',
      SEED_ALLOW_PROD: '1',
    })).toThrow('exact hosted');
  });

  it('is idempotent when every required bucket already exists privately', async () => {
    const storage = api();
    await expect(setupStagingStorage(storage)).resolves.toEqual({
      created: [], existing: ['media', 'submissions', 'certificates'],
    });
    expect(storage.createPrivateBucket).not.toHaveBeenCalled();
  });

  it('creates only missing private buckets', async () => {
    const storage = api([{ id: 'media', public: false }]);
    await expect(setupStagingStorage(storage)).resolves.toEqual({
      created: ['submissions', 'certificates'], existing: ['media'],
    });
    expect(storage.createPrivateBucket).toHaveBeenCalledTimes(2);
    expect(storage.createPrivateBucket).toHaveBeenNthCalledWith(1, 'submissions');
    expect(storage.createPrivateBucket).toHaveBeenNthCalledWith(2, 'certificates');
  });

  it('rejects an existing public required bucket without altering any bucket', async () => {
    const storage = api([{ id: 'media', public: false }, { id: 'certificates', public: true }]);
    await expect(setupStagingStorage(storage)).rejects.toThrow('certificates is public');
    expect(storage.createPrivateBucket).not.toHaveBeenCalled();
  });

  it('does not expose a Storage API response body when the API rejects a request', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('credential=should-not-appear', { status: 401 }));
    const storage = createStagingStorageApi('https://stage-ref.supabase.co', 'service-key', request);
    await expect(storage.listBuckets()).rejects.toThrow('Storage API request failed.');
  });

  it('creates buckets through the Storage API with private visibility', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    const storage = createStagingStorageApi('https://stage-ref.supabase.co', 'service-key', request);
    await storage.createPrivateBucket('certificates');
    expect(request).toHaveBeenCalledOnce();
    const [, init] = request.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ id: 'certificates', name: 'certificates', public: false });
  });
});
