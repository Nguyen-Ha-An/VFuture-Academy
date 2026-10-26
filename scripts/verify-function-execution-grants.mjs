#!/usr/bin/env node
// Hosted Supabase grants functions directly to API roles as well as PUBLIC.
// A PUBLIC-only revoke must not let clients invoke trusted progress mutations.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createFullAdminDatabase } from './verify-admin-migrations.mjs';
import { loadPGlite } from './lib/admin-db-harness.mjs';

const loaded = await loadPGlite(process.argv[2] ?? process.env.PGLITE_MODULE_PATH);
try {
  const db = await createFullAdminDatabase(loaded.PGlite, { hostedFunctionDefaults: true });
  try {
    const exposed = (await db.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anonymous,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      order by p.proname
    `)).rows;
    assert.deepEqual(exposed, [
      { proname: 'can_access_course', anonymous: false, signed_in: true, service: true },
      { proname: 'current_branch_id', anonymous: false, signed_in: true, service: true },
    ], 'Only the two authenticated RLS helpers may expose SECURITY DEFINER execution');

    const rpcCalls = [
      "select * from public.learner_mark_viewed('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','lesson',now())",
      "select * from public.learner_complete_course('00000000-0000-4000-8000-000000000001','course','00000000-0000-4000-8000-000000000002',now())",
      "select * from public.learner_claim_completion_effect('00000000-0000-4000-8000-000000000001','course',now())",
    ];
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const call of rpcCalls) {
        await assert.rejects(() => db.query(call), /permission denied for function/);
      }
      if (role === 'authenticated') {
        assert.deepEqual((await db.query("select public.can_access_course('missing-course') as allowed, public.current_branch_id() as branch")).rows,
          [{ allowed: false, branch: null }]);
      }
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.deepEqual((await db.query(rpcCalls[2])).rows, []);
    await assert.rejects(() => db.query(rpcCalls[0]), /ACTIVE_ENROLLMENT_REQUIRED/);
    await assert.rejects(() => db.query(rpcCalls[1]), /ACTIVE_ENROLLMENT_REQUIRED/);
    await db.exec('reset role');

    // Revoking a trigger function's direct EXECUTE must preserve Auth bootstrap.
    await db.query("insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000003','function-grants@example.test')");
    assert.equal((await db.query('select count(*)::integer as n from public.profiles')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::integer as n from public.user_accounts')).rows[0].n, 1);
    console.log('Hosted function defaults: public RPC denial, service progress RPCs, RLS helpers, and Auth bootstrap passed.');
  } finally {
    await db.close();
  }
} finally {
  if (loaded.temporaryPrefix) rmSync(loaded.temporaryPrefix, { recursive: true, force: true });
}
