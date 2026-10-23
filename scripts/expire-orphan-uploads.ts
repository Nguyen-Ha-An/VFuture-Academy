import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { createServiceClient } from '../src/lib/supabase/service-client';
import { loadEnvironment } from './load-env';

const DEFAULT_RETENTION_HOURS = 24;
const PAGE_SIZE = 500;

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Lists old, item-scoped submission assets that no submission_files row references. */
export async function findOrphanUploads(
  service: ServiceClient,
  now = new Date(),
  retentionHours = DEFAULT_RETENTION_HOURS,
) {
  const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from('media_assets')
    .select('id,item_id,path,created_at,submission_files!left(asset_id)')
    .eq('bucket', 'submissions')
    .lt('created_at', cutoff)
    .is('submission_files.asset_id', null)
    .limit(PAGE_SIZE);
  if (error) throw new Error('Unable to list orphan submission uploads', { cause: error });
  return data ?? [];
}

/* v8 ignore start -- operator-only dry run; query behavior is covered structurally. */
async function main() {
  loadEnvironment();
  const environment = environmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const service = createServiceClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
  );
  const candidates = await findOrphanUploads(service);
  // Dry run only: deletion is intentionally disabled until retention and alerting are operationally approved.
  console.log(`Dry run: ${candidates.length} orphan submission upload(s) are eligible for expiry.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error('Orphan upload expiry dry run failed:', error);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
