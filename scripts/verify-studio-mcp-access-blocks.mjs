#!/usr/bin/env node
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';
import { loadPGlite } from './lib/admin-db-harness.mjs';

const adminId = 'ffffffff-0000-4000-8000-000000000001';
const learnerId = 'ffffffff-0000-4000-8000-000000000002';
const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);

try {
  const db = await createFullAdminDatabase(loaded.PGlite, { seedLegacyFixtures: true });
  try {
    const privilege = (await db.query(`
      select c.relrowsecurity as rls,
        (has_table_privilege('service_role', 'public.studio_mcp_access_blocks', 'SELECT')
          and has_table_privilege('service_role', 'public.studio_mcp_access_blocks', 'INSERT')
          and has_table_privilege('service_role', 'public.studio_mcp_access_blocks', 'UPDATE')
          and has_table_privilege('service_role', 'public.studio_mcp_access_blocks', 'DELETE')) as service_access,
        has_table_privilege('authenticated', 'public.studio_mcp_access_blocks', 'SELECT') as user_read,
        has_table_privilege('authenticated', 'public.studio_mcp_access_blocks', 'INSERT') as user_write,
        has_table_privilege('anon', 'public.studio_mcp_access_blocks', 'SELECT') as anonymous_read
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'studio_mcp_access_blocks'
    `)).rows[0];
    assert.deepEqual(privilege, {
      rls: true,
      service_access: true,
      user_read: false,
      user_write: false,
      anonymous_read: false,
    });

    const authUsersBefore = (await db.query('select count(*)::integer as n from auth.users')).rows[0].n;
    await db.exec('set role service_role');
    await db.query(`insert into public.studio_mcp_access_blocks (user_id, reason, blocked_by)
      values ($1, $2, $3)`, [learnerId, 'Test block', adminId]);
    assert.equal((await db.query('select count(*)::integer as n from public.studio_mcp_access_blocks where user_id = $1', [learnerId])).rows[0].n, 1);
    await db.query('delete from public.studio_mcp_access_blocks where user_id = $1', [learnerId]);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::integer as n from auth.users')).rows[0].n, authUsersBefore);
    console.log('Studio MCP block migration grants, RLS, and service-role write fixture passed.');
  } finally {
    await db.close();
  }
} finally {
  if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
}
