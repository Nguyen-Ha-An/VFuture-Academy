import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { initializeCmsReviewFixture } from '../verify-admin-content-review.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const binaryVersion = '17.10.0-beta.17';

// No application URL, hosted credentials, inherited PG routing, or TCP listener
// enters this fixture. Every database and Unix socket belongs to its temp root.
const fixtureEnvironment = () => Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !/^(?:PG|SUPABASE_|NEXT_PUBLIC_SUPABASE_|DATABASE_URL$)/.test(key)));

function binaries() {
  const supplied = process.env.STUDIO_POSTGRES_BIN ?? process.env.POSTGRES_BIN;
  if (supplied) {
    const bin = realpathSync(supplied);
    for (const name of ['initdb', 'pg_ctl', 'postgres']) {
      if (!existsSync(join(bin, name))) throw new Error(`Native PostgreSQL fixture requires ${name} in STUDIO_POSTGRES_BIN.`);
    }
    return { bin, temporaryRuntime: null };
  }
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error('The socket-only native PostgreSQL fixture requires macOS or Linux.');
  }
  const temporaryRuntime = mkdtempSync('/tmp/vfuture-studio-pg-runtime.');
  try {
    const packageName = `@embedded-postgres/${process.platform}-${process.arch}`;
    execFileSync('npm', ['install', '--prefix', temporaryRuntime, '--ignore-scripts', '--no-audit', '--no-fund', `${packageName}@${binaryVersion}`], {
      stdio: 'inherit', env: fixtureEnvironment(),
    });
    const packageRoot = join(temporaryRuntime, 'node_modules', packageName);
    // npm tarballs omit native shared-library symlinks. Hydrate the published
    // mapping within this package rather than execute dependency lifecycle code.
    const nativeRoot = join(packageRoot, 'native');
    for (const { source, target } of JSON.parse(readFileSync(join(nativeRoot, 'pg-symlinks.json'), 'utf8'))) {
      const realSource = resolve(packageRoot, source);
      const realTarget = resolve(packageRoot, target);
      for (const path of [realSource, realTarget]) {
        if (!path.startsWith(`${nativeRoot}/`)) throw new Error('Native PostgreSQL symlink escapes its isolated package.');
      }
      try { symlinkSync(relative(dirname(realTarget), realSource), realTarget); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return { bin: join(nativeRoot, 'bin'), temporaryRuntime };
  } catch (error) {
    rmSync(temporaryRuntime, { recursive: true, force: true });
    throw error;
  }
}

/** Capture pg's environment fallbacks synchronously without ambient PG settings. */
export function createStudioFixtureClient(config) {
  const inherited = Object.entries(process.env).filter(([key]) => key.startsWith('PG'));
  for (const [key] of inherited) delete process.env[key];
  try { return new pg.Client({ ...config, ssl: false }); }
  finally { for (const [key, value] of inherited) process.env[key] = value; }
}

export async function runIsolatedStudioConcurrency() {
  let owned;
  let cluster;
  let data;
  let socket;
  let control;
  let fixture;
  let child;
  let timer;
  let cleaned = false;
  const env = fixtureEnvironment();
  const invoke = (name, args) => execFileSync(join(owned.bin, name), args, { encoding: 'utf8', env });
  const cleanup = () => {
    if (cleaned) return;
    clearTimeout(timer);
    child?.kill('SIGTERM');
    // Stop the daemon before removing any owned data or native binaries. If
    // shutdown fails, preserve both for explicit operator recovery.
    if (data && existsSync(join(data, 'postmaster.pid'))) invoke('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
    if (owned?.temporaryRuntime) rmSync(owned.temporaryRuntime, { recursive: true, force: true });
    cleaned = true;
  };
  const onExit = () => {
    try { cleanup(); }
    catch { console.error('Native PostgreSQL fixture shutdown failed; owned files retained for recovery.'); process.exitCode = 1; }
  };
  const onInterrupt = () => {
    try { cleanup(); } finally { process.exit(130); }
  };
  const onTerminate = () => {
    try { cleanup(); } finally { process.exit(143); }
  };
  process.once('exit', onExit);
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    owned = binaries();
    cluster = realpathSync(mkdtempSync('/tmp/studio-postgres.'));
    data = join(cluster, 'data');
    socket = join(cluster, 'socket');
    mkdirSync(socket, { mode: 0o700 });
    const database = 'studio_concurrency';
    const config = { host: socket, user: 'studio_test', port: 55439, connectionTimeoutMillis: 5000 };
    invoke('initdb', ['-D', data, '-U', 'studio_test', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--no-locale']);
    invoke('pg_ctl', ['-D', data, '-l', join(cluster, 'postgres.log'), '-o', `-k ${socket} -p 55439 -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off`, '-w', 'start']);
    control = createStudioFixtureClient({ ...config, database: 'postgres' });
    await control.connect();
    const settings = await control.query('show listen_addresses');
    if (settings.rows[0].listen_addresses !== '') throw new Error('Native fixture must not listen on TCP.');
    await control.query(`create database ${database}`);
    fixture = createStudioFixtureClient({ ...config, database });
    await fixture.connect();
    await initializeCmsReviewFixture({ exec: sql => fixture.query(sql) });
    await fixture.end();
    fixture = null;
    await control.end();
    control = null;
    await new Promise((resolveRun, rejectRun) => {
      child = spawn(process.execPath, [join(repositoryRoot, 'scripts/verify-studio-workflow-concurrency.mjs'), socket, database], {
        cwd: repositoryRoot, env, stdio: 'inherit',
      });
      timer = setTimeout(() => { child.kill('SIGTERM'); rejectRun(new Error('Native Studio workflow concurrency contract timed out.')); }, 120000);
      child.once('error', rejectRun);
      child.once('exit', (code) => {
        child = null;
        clearTimeout(timer);
        if (code === 0) resolveRun();
        else rejectRun(new Error('Native Studio workflow concurrency contract failed.'));
      });
    });
    console.log('Native PostgreSQL concurrency fixture passed with TCP disabled.');
  } finally {
    try {
      await fixture?.end().catch(() => {});
      await control?.end().catch(() => {});
      cleanup();
    } finally {
      process.removeListener('exit', onExit);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    }
  }
}
