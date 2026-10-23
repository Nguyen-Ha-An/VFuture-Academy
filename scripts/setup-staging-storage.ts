import { pathToFileURL } from 'node:url';

import { loadEnvironment } from './load-env';

export const REQUIRED_STAGING_BUCKETS = ['media', 'submissions', 'certificates'] as const;

type RequiredBucket = typeof REQUIRED_STAGING_BUCKETS[number];
type StorageBucket = { id: string; public: boolean };

export interface StagingStorageApi {
  listBuckets(): Promise<StorageBucket[]>;
  createPrivateBucket(id: RequiredBucket): Promise<void>;
}

export type StagingStorageSummary = { created: RequiredBucket[]; existing: RequiredBucket[] };
export type StagingStorageEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SEED_DEV_PROJECT_REF: string;
};

const projectRefPattern = /^[a-z0-9-]+$/;

/** Storage setup has no production escape hatch: it requires the exact supplied hosted project. */
export function assertStagingStorageTarget(supabaseUrl: string, projectRef: string): void {
  const normalizedRef = projectRef.trim().toLowerCase();
  try {
    const url = new URL(supabaseUrl);
    const exactHost = `${normalizedRef}.supabase.co`;
    if (
      !projectRefPattern.test(normalizedRef)
      || url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== exactHost
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) throw new Error();
  } catch {
    throw new Error('Staging Storage target must match the exact hosted SEED_DEV_PROJECT_REF.');
  }
}

export function readStagingStorageEnvironment(source: Record<string, string | undefined> = process.env): StagingStorageEnvironment {
  const apiUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = source.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = source.SEED_DEV_PROJECT_REF?.trim().toLowerCase();
  if (!apiUrl || !serviceKey || !projectRef || !projectRefPattern.test(projectRef)) {
    throw new Error('Missing or invalid staging Storage configuration.');
  }
  assertStagingStorageTarget(apiUrl, projectRef);
  return {
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SEED_DEV_PROJECT_REF: projectRef,
  };
}

function parsedBuckets(value: unknown): StorageBucket[] {
  if (!Array.isArray(value)) throw new Error('Storage API response was invalid.');
  const buckets: StorageBucket[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const bucket = item as { id?: unknown; public?: unknown };
    if (typeof bucket.id !== 'string' || typeof bucket.public !== 'boolean') continue;
    buckets.push({ id: bucket.id, public: bucket.public });
  }
  return buckets;
}

/** Creates only absent buckets; visibility of an existing bucket is never changed. */
export async function setupStagingStorage(api: StagingStorageApi): Promise<StagingStorageSummary> {
  const buckets = await api.listBuckets();
  const byId = new Map(buckets.map(bucket => [bucket.id, bucket]));
  const existing = REQUIRED_STAGING_BUCKETS.filter(id => byId.has(id));
  const publicBucket = existing.find(id => byId.get(id)?.public === true);
  if (publicBucket) throw new Error(`Required staging bucket ${publicBucket} is public; refusing to alter it.`);

  const created: RequiredBucket[] = [];
  for (const id of REQUIRED_STAGING_BUCKETS) {
    if (byId.has(id)) continue;
    await api.createPrivateBucket(id);
    created.push(id);
  }
  return { created, existing };
}

export function createStagingStorageApi(
  supabaseUrl: string,
  serviceKey: string,
  request: typeof fetch = fetch,
): StagingStorageApi {
  const endpoint = `${new URL(supabaseUrl).origin}/storage/v1/bucket`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  async function call(init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await request(endpoint, {
        ...init,
        headers: { ...headers, ...(init?.headers ?? {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Storage API request failed.');
    }
    if (!response.ok) throw new Error('Storage API request failed.');
    return response;
  }
  return {
    async listBuckets() {
      const response = await call();
      try { return parsedBuckets(await response.json()); }
      catch { throw new Error('Storage API response was invalid.'); }
    },
    async createPrivateBucket(id) {
      await call({ method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id, public: false }) });
    },
  };
}

async function main() {
  loadEnvironment();
  const environment = readStagingStorageEnvironment();
  const result = await setupStagingStorage(createStagingStorageApi(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
  ));
  console.log(`Staging Storage setup complete. Created: ${result.created.join(', ') || 'none'}; existing: ${result.existing.join(', ') || 'none'}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error('Staging Storage setup failed. Check configuration, target, bucket state, and API access; credential values are not logged.');
    process.exitCode = 1;
  });
}
