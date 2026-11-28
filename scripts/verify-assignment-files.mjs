import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadPGlite, repositoryRoot } from './lib/admin-db-harness.mjs';

const loaded = await loadPGlite(process.env.PGLITE_RUNTIME);
const db = new loaded.PGlite();
const version = randomUUID(), owner = randomUUID(), operation = randomUUID(), file = randomUUID();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table course_version_items (version_id uuid, item_id text, primary key(version_id,item_id));
    create table enrollments (user_id uuid, course_id text, course_version_id uuid, status text, branch_scope_known boolean, branch_id text);
    create table media_assets (id text primary key, owner_id uuid, bucket text, path text, purpose text, item_id text, mime text, size_bytes bigint);
    create table assignment_submissions (id uuid primary key, user_id uuid, course_version_id uuid, item_id text, block_id text, branch_scope_known boolean, branch_id text);
    create table submission_files (submission_id uuid, user_id uuid, asset_id text, primary key(submission_id,asset_id));
    grant select, insert on all tables in schema public to service_role;
  `);
  await db.exec(readFileSync(join(repositoryRoot, 'supabase/migrations/20261128000001_academy_private_assignment_files.sql'), 'utf8'));
  await db.query("insert into course_version_items values ($1,'assignment');", [version]);
  await db.query("insert into enrollments values ($1,'course',$2,'active',true,'school-a');", [owner, version]);
  const first = randomUUID(), wrong = randomUUID(), legacy = randomUUID();
  await db.query("insert into assignment_submissions values ($1,$3,$4,'assignment',null,true,'school-a'), ($2,$3,$4,'assignment',null,true,'school-b'), ($5,$3,$4,'legacy',null,false,null)", [first, wrong, owner, version, legacy]);
  await db.query("insert into media_assets values ('asset_legacy',$1,'submissions','legacy.pdf','submission','legacy','application/pdf',50)", [owner]);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from academy_assignment_files'), /permission denied/);
  await assert.rejects(db.query('select academy_assignment_file_complete($1,$2,$3)', [owner, operation, file]), /permission denied/);
  await db.exec('reset role; set role authenticated');
  await assert.rejects(db.query('select * from academy_assignment_files'), /permission denied/);
  await db.exec('reset role; set role service_role');
  await db.query(`insert into academy_assignment_files
    (operation_id, asset_id, owner_id, course_id, course_version_id, item_id, branch_id, filename, size_bytes, sha256, source_ref)
    values ($1, 'asset_first', $2, 'course', $3, 'assignment', 'school-a', 'work.pdf', 50, repeat('a',64), 'assignment/'|| repeat('b',64))`, [operation, owner, version]);
  const complete = (actor, target) => db.query('select academy_assignment_file_complete($1,$2,$3) as attachment', [actor, operation, target]);
  await assert.rejects(complete(randomUUID(), file), /UPLOAD_NOT_FOUND/);
  const { rows: [result] } = await complete(owner, file);
  assert.equal(result.attachment.file_id, file);
  assert.equal((await complete(owner, file)).rows[0].attachment.file_id, file);
  await assert.rejects(complete(owner, randomUUID()), /UPLOAD_CONFLICT/);
  const attach = (submission, asset) => db.query('insert into submission_files values ($1,$2,$3)', [submission, owner, asset]);
  await assert.rejects(attach(wrong, 'asset_first'), /INVALID_SUBMISSION_FILE/);
  await attach(first, 'asset_first');
  await attach(legacy, 'asset_legacy');
  console.log('Assignment journal permissions, atomic completion, same-ID replay, school scope and legacy submission passed.');
} finally {
  await db.close();
  if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
}
