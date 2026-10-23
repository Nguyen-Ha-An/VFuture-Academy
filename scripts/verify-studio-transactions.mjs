#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PGLITE_VERSION = '0.3.14';
const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(repositoryRoot, 'supabase', 'migrations', '0034_studio_atomic_workspace.sql');

function moduleEntry(location) {
  const candidate = resolve(location);
  if (!existsSync(candidate)) throw new Error(`PGlite module location does not exist: ${candidate}`);
  if (candidate.endsWith('.js') || candidate.endsWith('.mjs')) return candidate;
  return require.resolve('@electric-sql/pglite', { paths: [candidate] });
}

async function loadPGlite() {
  const supplied = process.argv[2] ?? process.env.PGLITE_MODULE_PATH;
  if (supplied) {
    const entry = moduleEntry(isAbsolute(supplied) ? supplied : resolve(repositoryRoot, supplied));
    return { PGlite: (await import(pathToFileURL(entry).href)).PGlite, temporaryPrefix: null };
  }

  const temporaryPrefix = await mkdtemp(join(tmpdir(), 'vfuture-pglite-'));
  const installed = spawnSync('npm', [
    'install',
    '--prefix', temporaryPrefix,
    '--no-save',
    '--ignore-scripts',
    `@electric-sql/pglite@${PGLITE_VERSION}`,
  ], { encoding: 'utf8' });
  if (installed.status !== 0) {
    rmSync(temporaryPrefix, { recursive: true, force: true });
    throw new Error(`Unable to install temporary PGlite runtime: ${installed.stderr.trim() || installed.stdout.trim()}`);
  }
  try {
    const entry = moduleEntry(temporaryPrefix);
    return { PGlite: (await import(pathToFileURL(entry).href)).PGlite, temporaryPrefix };
  } catch (error) {
    rmSync(temporaryPrefix, { recursive: true, force: true });
    throw error;
  }
}

async function verify(PGlite) {
  const db = new PGlite();
  const actor = '00000000-0000-4000-8000-000000000001';
  const draftId = '00000000-0000-4000-8000-000000000002';
  const versionId = '00000000-0000-4000-8000-000000000003';
  const initialRevision = '2026-09-02T00:00:00Z';
  const one = (sql, params = []) => db.query(sql, params).then((result) => result.rows[0]);

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.profiles(id uuid primary key);
      create table public.courses(
        id text primary key,
        slug text unique,
        owner_id uuid not null references profiles(id),
        status text not null,
        created_at timestamptz,
        updated_at timestamptz
      );
      create table public.course_versions(
        id uuid primary key,
        course_id text not null references courses(id),
        version int not null
      );
      create table public.course_drafts(
        id uuid primary key default gen_random_uuid(),
        course_id text not null unique references courses(id),
        manifest jsonb not null,
        base_version_id uuid,
        checklist jsonb not null default '{}',
        updated_by uuid,
        updated_at timestamptz not null
      );
      create table public.course_draft_items(
        draft_id uuid not null references course_drafts(id) on delete cascade,
        item_id text not null,
        kind text not null check(kind in ('lesson', 'exam', 'assignment')),
        document jsonb not null,
        updated_by uuid,
        updated_at timestamptz not null,
        primary key(draft_id, item_id)
      );
      create table public.skills(
        id text primary key,
        name jsonb not null,
        category text not null check(category in ('ai', 'technology', 'research', 'entrepreneurship', 'fintech', 'core-skills', 'other')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.published(course_id text, at timestamptz default now());
      create function public.studio_publish_version(text, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb)
      returns jsonb language plpgsql as $$
      begin
        insert into public.published(course_id) values ($1);
        if $7 = 'force-failure' then
          raise exception 'forced publisher failure';
        end if;
        return jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000009',
          'version', 1,
          'checksum', 'ok'
        );
      end
      $$;
    `);
    await db.exec(readFileSync(migrationPath, 'utf8'));
    await db.exec(`
      insert into profiles values ('${actor}');
      insert into courses values ('course-one', 'course-one', '${actor}', 'draft', now(), now());
      insert into course_versions values ('${versionId}', 'course-one', 1);
      insert into course_drafts(id, course_id, manifest, base_version_id, updated_by, updated_at)
      values ('${draftId}', 'course-one', '{"id":"course-one"}', null, '${actor}', '${initialRevision}');
      insert into course_draft_items
      values ('${draftId}', 'old', 'lesson', '{"id":"old","kind":"lesson"}', '${actor}', '${initialRevision}');
      insert into skills(id, name, category) values ('existing-skill', '"Original name"', 'other');
    `);

    const manifest = { id: 'course-one', kind: 'course' };
    const items = { first: { id: 'first', kind: 'lesson' } };
    const saved = await one(
      'select public.studio_save_draft_workspace($1,$2,$3,$4,$5,$6,$7) result',
      ['course-one', manifest, items, actor, initialRevision, null, false],
    );
    if (saved.result.conflict || saved.result.draft.items.first.id !== 'first') throw new Error('Atomic workspace save failed');
    const savedRevision = saved.result.draft.updated_at;

    const stale = await one(
      'select public.studio_save_draft_workspace($1,$2,$3,$4,$5,$6,$7) result',
      ['course-one', manifest, items, actor, initialRevision, null, false],
    );
    if (!stale.result.conflict) throw new Error('A stale workspace revision was accepted');

    const invalidBase = await one(
      'select public.studio_save_draft_workspace($1,$2,$3,$4,$5,$6,$7) result',
      ['course-one', manifest, items, actor, savedRevision, '00000000-0000-4000-8000-000000000099', true],
    );
    if (!invalidBase.result.invalid_base_version) throw new Error('A foreign base version was accepted');

    const changedKind = await one(
      'select public.studio_save_draft_workspace($1,$2,$3,$4,$5,$6,$7) result',
      ['course-one', manifest, { first: { id: 'first', kind: 'exam' } }, actor, savedRevision, null, false],
    );
    if (!changedKind.result.immutable_kind_conflict) throw new Error('An existing item kind was changed');

    try {
      await one(
        'select public.studio_save_draft_workspace($1,$2,$3,$4,$5,$6,$7)',
        ['course-one', manifest, { bad: { id: 'bad', kind: null } }, actor, savedRevision, null, false],
      );
      throw new Error('An invalid item unexpectedly committed');
    } catch (error) {
      if (String(error).includes('unexpectedly committed')) throw error;
    }
    const afterRollback = await one('select public.studio_get_draft_snapshot($1) result', ['course-one']);
    if (afterRollback.result.items.first.id !== 'first' || afterRollback.result.updated_at !== savedRevision) {
      throw new Error('A failed item replacement did not roll back the workspace');
    }

    const restored = await one(
      'select public.studio_save_draft_workspace($1,$2,$3,$4,$5,$6,$7) result',
      ['course-one', manifest, items, actor, savedRevision, versionId, true],
    );
    if (restored.result.draft.base_version_id !== versionId) throw new Error('A verified base version was not saved');
    const currentRevision = restored.result.draft.updated_at;

    const imported = await one(
      'select public.studio_import_course($1,$2,$3,$4) result',
      ['course-two', actor, { id: 'course-two' }, { x: { id: 'x', kind: 'assignment' } }],
    );
    if (imported.result.conflict || imported.result.draft.items.x.id !== 'x') throw new Error('Atomic course import failed');
    const duplicate = await one(
      'select public.studio_import_course($1,$2,$3,$4) result',
      ['course-two', actor, { id: 'course-two' }, {}],
    );
    if (!duplicate.result.conflict) throw new Error('A duplicate course import was accepted');

    const declarations = [
      { id: 'existing-skill', name: 'Changed name' },
      { id: 'new-skill', name: { en: 'New skill' } },
    ];
    const publishArgs = ['course-one', manifest, { courseId: 'course-one' }, {}, {}, actor, null, {}, initialRevision, declarations, 'ai'];
    const stalePublish = await one(
      'select public.studio_publish_version_guarded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',
      publishArgs,
    );
    if (!stalePublish.result.conflict) throw new Error('A stale publish was accepted');
    const skillsAfterConflict = await one('select count(*)::int count from public.skills');
    if (skillsAfterConflict.count !== 1) throw new Error('A stale publish inserted skills');
    publishArgs[8] = currentRevision;
    const published = await one(
      'select public.studio_publish_version_guarded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',
      publishArgs,
    );
    if (published.result.conflict || published.result.version !== 1) throw new Error('A current publish failed');
    const publishCount = await one('select count(*)::int count from public.published');
    if (publishCount.count !== 1) throw new Error('The guarded publisher committed an unexpected number of rows');
    const synchronizedSkills = await db.query('select id, name, category from public.skills order by id');
    if (synchronizedSkills.rows.length !== 2
        || synchronizedSkills.rows[0].name !== 'Original name'
        || synchronizedSkills.rows[1].category !== 'ai') {
      throw new Error('Transactional skill synchronization did not preserve ignoreDuplicates semantics');
    }

    const failingPublishArgs = [...publishArgs];
    failingPublishArgs[6] = 'force-failure';
    failingPublishArgs[9] = [{ id: 'rolled-back-skill', name: 'Must roll back' }];
    try {
      await one(
        'select public.studio_publish_version_guarded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        failingPublishArgs,
      );
      throw new Error('A forced publisher failure unexpectedly committed');
    } catch (error) {
      if (String(error).includes('unexpectedly committed')) throw error;
    }
    const rollbackCounts = await one(`select
      (select count(*)::int from public.published) published_count,
      (select count(*)::int from public.skills where id = 'rolled-back-skill') skill_count
    `);
    if (rollbackCounts.published_count !== 1 || rollbackCounts.skill_count !== 0) {
      throw new Error('A failed publisher did not roll back skill synchronization');
    }

    const acl = await one(`select
      has_function_privilege('service_role', 'public.studio_save_draft_workspace(text,jsonb,jsonb,uuid,timestamptz,uuid,boolean)', 'execute') service_ok,
      has_function_privilege('authenticated', 'public.studio_save_draft_workspace(text,jsonb,jsonb,uuid,timestamptz,uuid,boolean)', 'execute') authenticated_ok,
      has_function_privilege('anon', 'public.studio_save_draft_workspace(text,jsonb,jsonb,uuid,timestamptz,uuid,boolean)', 'execute') anon_ok
    `);
    if (!acl.service_ok || acl.authenticated_ok || acl.anon_ok) throw new Error('Studio RPC privileges are unsafe');
  } finally {
    await db.close();
  }
}

let temporaryPrefix = null;
try {
  const loaded = await loadPGlite();
  temporaryPrefix = loaded.temporaryPrefix;
  await verify(loaded.PGlite);
  console.log('Studio PostgreSQL transaction verification passed.');
} finally {
  if (temporaryPrefix) rmSync(temporaryPrefix, { recursive: true, force: true });
}
