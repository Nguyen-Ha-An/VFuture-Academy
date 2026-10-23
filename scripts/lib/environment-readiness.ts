export type ReadinessCheck = { id: string; status: 'pass' | 'fail' | 'blocked'; detail: string };
export type ReadinessReport = { ok: boolean; checks: ReadinessCheck[] };
export type ReadinessEnvironment = Record<string, string | undefined>;
export interface ReadinessProbes {
  database(url: string): Promise<{ missingTables: string[]; missingMigrations: string[]; unexpectedMigrations: string[] }>;
  storage(url: string, key: string): Promise<Array<{ id: string; public: boolean }>>;
  auth(url: string, key: string): Promise<{ external?: { email?: boolean; google?: boolean } }>;
}

export function httpOrigin(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.protocol === 'https:' || (local && url.protocol === 'http:') ? url : null;
  } catch { return null; }
}

// Match the staging target's fail-closed identity policy before pg interprets
// query parameters. Also reject nested connections and libpq service/database
// routing so a future driver cannot redirect an inspected URL implicitly.
const POSTGRES_CONNECTION_OVERRIDE_KEYS = new Set([
  'host', 'hostaddr', 'port', 'user', 'password',
  'connectionstring', 'database', 'dbname', 'service', 'servicefile',
]);

function postgresUrl(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? '');
    if ([...url.searchParams.keys()].some(key => POSTGRES_CONNECTION_OVERRIDE_KEYS.has(key.toLowerCase()))) return null;
    // The driver decodes hostname and credentials; reject malformed encoding
    // before any probe can use a different identity than the inspected URL.
    decodeURIComponent(url.hostname);
    decodeURIComponent(url.username);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname ? url : null;
  } catch { return null; }
}

/** Reports only fixed diagnostic text and known identifiers, never probe errors or values. */
export async function checkEnvironment(source: ReadinessEnvironment, probes: ReadinessProbes, options: { configurationOnly?: boolean } = {}): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, status: ok ? 'pass' : 'fail', detail });
  const api = httpOrigin(source.NEXT_PUBLIC_SUPABASE_URL);
  const app = httpOrigin(source.NEXT_PUBLIC_APP_URL);
  const db = postgresUrl(source.SUPABASE_DB_URL);
  for (const [id, valid] of [
    ['NEXT_PUBLIC_SUPABASE_URL', Boolean(api)], ['NEXT_PUBLIC_APP_URL', Boolean(app)], ['SUPABASE_DB_URL', Boolean(db)],
  ] as const) add(id, valid, valid ? 'Valid URL format.' : 'Missing or invalid URL format.');
  for (const id of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET']) {
    const present = Boolean(source[id]?.trim());
    add(id, present, present ? 'Configured; availability checked separately.' : 'Required value is missing.');
  }
  const rateLimit = source.TRUSTED_PROXY?.trim() === '1' || Boolean(source.RATE_LIMIT_COOKIE_SECRET?.trim());
  add('rate-limit', rateLimit, rateLimit ? 'Runtime identity source configured.' : 'Configure RATE_LIMIT_COOKIE_SECRET or a trusted proxy.');
  if (api && db) {
    const apiRef = /^([a-z0-9-]+)\.supabase\.(?:co|in)$/.exec(api.hostname)?.[1];
    const databaseHostname = decodeURIComponent(db.hostname).toLowerCase();
    const dbRef = /^db\.([a-z0-9-]+)\.supabase\.(?:co|in)$/.exec(databaseHostname)?.[1]
      ?? (databaseHostname.endsWith('.pooler.supabase.com') ? /^postgres\.([a-z0-9-]+)$/.exec(decodeURIComponent(db.username))?.[1] : undefined);
    // A recognized hosted API must have a recognized matching database project;
    // an unidentified host or pooled username is not evidence of consistency.
    const consistent = !apiRef || apiRef === dbRef;
    add('project-consistency', consistent, consistent
      ? apiRef ? 'API and database project identities match.' : 'No hosted Supabase project identity is available for comparison.'
      : 'API and database project identities differ or could not be established.');
  }
  if (checks.some(c => c.status === 'fail')) {
    for (const id of ['database', 'schema', 'migrations', 'storage', 'auth']) checks.push({ id, status: 'blocked', detail: 'Resolve configuration errors before network checks.' });
    return { ok: false, checks };
  }
  if (options.configurationOnly) return { ok: true, checks };
  try {
    const schema = await probes.database(source.SUPABASE_DB_URL!);
    add('database', true, 'Read-only database connection succeeded.');
    add('schema', schema.missingTables.length === 0, schema.missingTables.length ? 'Required application tables are missing; apply checked-in migrations.' : 'Required application tables are present.');
    add('migrations', schema.missingMigrations.length === 0 && schema.unexpectedMigrations.length === 0,
      schema.missingMigrations.length || schema.unexpectedMigrations.length ? 'Migration ledger does not match checked-in migrations.' : 'Migration ledger matches checked-in migrations.');
  } catch {
    add('database', false, 'Database probe failed; check connection, credentials, TLS, and network access.');
    for (const id of ['schema', 'migrations']) checks.push({ id, status: 'blocked', detail: 'Database probe did not complete.' });
  }
  try {
    const buckets = await probes.storage(api!.origin, source.SUPABASE_SERVICE_ROLE_KEY!);
    for (const [id, isPublic] of [['media', false], ['submissions', false], ['certificates', false]] as const) {
      const bucket = buckets.find(b => b.id === id);
      const valid = bucket?.public === isPublic;
      add(`storage.${id}`, valid, valid ? 'Bucket exists with expected visibility.' : 'Bucket missing or visibility is incorrect.');
    }
  } catch { add('storage', false, 'Storage probe failed; check service credentials and storage availability.'); }
  try {
    const settings = await probes.auth(api!.origin, source.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    for (const id of ['email', 'google'] as const) {
      const enabled = settings.external?.[id] === true;
      add(`auth.${id}`, enabled, enabled ? 'Provider enabled; sign-in and redirects require a browser walkthrough.' : 'Provider is not enabled.');
    }
  } catch { add('auth', false, 'Auth settings probe failed; check public key and Auth availability.'); }
  return { ok: checks.every(c => c.status === 'pass'), checks };
}
