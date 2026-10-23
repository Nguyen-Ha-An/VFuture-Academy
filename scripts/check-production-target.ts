import { assertStagingMigrationTarget, type StagingTargetEnvironment } from './check-staging-target';

// Each Academy deployment designates its own Database/Auth project.
export const PRODUCTION_PROJECT_REF = process.env.SUPABASE_PRODUCTION_PROJECT_REF?.trim() ?? '';

export function productionProjectRef(source: StagingTargetEnvironment): string {
  const designatedRef = source.SUPABASE_PRODUCTION_PROJECT_REF?.trim();
  if (!designatedRef || !/^[a-z0-9-]+$/.test(designatedRef)) throw new Error('SUPABASE_PRODUCTION_PROJECT_REF is required.');
  let database: URL;
  try { database = new URL(source.SUPABASE_PRODUCTION_DB_URL ?? ''); }
  catch { throw new Error('An identifiable production database URL is required.'); }
  const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/.exec(database.hostname)?.[1];
  const pooled = database.hostname.endsWith('.pooler.supabase.com')
    ? /^postgres\.([a-z0-9-]+)$/.exec(decodeURIComponent(database.username))?.[1] : undefined;
  const ref = direct ?? pooled;
  if (!ref) throw new Error('The production Supabase project could not be identified.');
  if (ref !== designatedRef) {
    throw new Error('The database must match the designated production project.');
  }
  assertStagingMigrationTarget({
    SEED_DEV_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_DB_URL: database.toString(),
  });
  return ref;
}

if (process.argv[1]?.endsWith('check-production-target.ts')) {
  try { console.log(`Verified production project: ${productionProjectRef(process.env)}`); }
  catch (error) {
    console.error(error instanceof Error && error.message === 'The database must match the designated production project.'
      ? 'The configured database is not the designated production project; migrations were refused.'
      : 'Production target verification failed; refusing unknown or redirected destinations.');
    process.exitCode = 1;
  }
}
