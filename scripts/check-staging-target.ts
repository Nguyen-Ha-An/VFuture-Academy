export type StagingTargetEnvironment = Record<string, string | undefined>;

/** Refuses staging DDL unless API and database addresses name the configured staging project. */
export function assertStagingMigrationTarget(source: StagingTargetEnvironment): string {
  const ref = source.SEED_DEV_PROJECT_REF?.trim();
  if (!ref || !/^[a-z0-9-]+$/.test(ref)) throw new Error('An explicit staging project reference is required.');
  let api: URL;
  let database: URL;
  try {
    api = new URL(source.NEXT_PUBLIC_SUPABASE_URL ?? '');
    database = new URL(source.SUPABASE_DB_URL ?? '');
  } catch { throw new Error('Staging API and database URLs must be configured.'); }
  if (api.protocol !== 'https:' || api.username || api.password || api.port || api.pathname !== '/'
    || api.search || api.hash || api.hostname !== `${ref}.supabase.co`) {
    throw new Error('The API URL does not match the configured staging project.');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('The staging database must use Postgres.');
  if (['host', 'hostaddr', 'port', 'user', 'password'].some((key) => database.searchParams.has(key))) {
    throw new Error('Database URL query parameters must not override the verified staging connection identity.');
  }
  const direct = database.hostname === `db.${ref}.supabase.co`;
  const pooled = database.hostname.endsWith('.pooler.supabase.com')
    && decodeURIComponent(database.username) === `postgres.${ref}`;
  if (!direct && !pooled) throw new Error('The database URL does not match the configured staging project.');
  return ref;
}

if (process.argv[1]?.endsWith('check-staging-target.ts')) {
  try {
    assertStagingMigrationTarget(process.env);
    console.log('Staging API and database target identities match.');
  } catch {
    console.error('Staging target verification failed; migration was not authorized.');
    process.exitCode = 1;
  }
}
