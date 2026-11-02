import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Optional local PostgreSQL runtime. Release verification must run this suite with
// PGLITE_MODULE_PATH set; this is not hosted or concurrent PostgreSQL evidence.
const runtime = process.env.PGLITE_MODULE_PATH;
type Database = { exec(sql: string): Promise<unknown>; query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; close(): Promise<void> };
describe.skipIf(!runtime)('Azure identity SQL contracts', () => {
  let db: Database;
  const issuer = 'https://identity.example/tenant/v2.0';
  const oid = '22222222-2222-4222-8222-222222222222';
  const original = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ pathToFileURL(resolve(runtime!, 'dist/index.js')).href);
    const { pgcrypto } = await import(/* @vite-ignore */ pathToFileURL(resolve(runtime!, 'dist/contrib/pgcrypto.js')).href);
    const { buildAzureSchema } = await import('../../scripts/azure-core/schema.mjs');
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(buildAzureSchema().sql);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  it('consumes login transactions exactly once and checks browser binding', async () => {
    await db.query('select public.academy_identity_start_login($1,$2,$3)', ['a'.repeat(64), 'b'.repeat(64), { state: 'secret' }]);
    expect((await db.query('select public.academy_identity_consume_login($1,$2) result', ['a'.repeat(64), 'c'.repeat(64)])).rows[0].result).toBeNull();
    expect((await db.query('select public.academy_identity_consume_login($1,$2) result', ['a'.repeat(64), 'b'.repeat(64)])).rows[0].result).toEqual({ state: 'secret' });
    expect((await db.query('select public.academy_identity_consume_login($1,$2) result', ['a'.repeat(64), 'b'.repeat(64)])).rows[0].result).toBeNull();
  });
  it('preserves prelinked internal UUIDs without trusting a changed email', async () => {
    await db.query('insert into academy_identity.users(id,email) values($1,$2)', [original, 'existing@example.test']);
    await db.query('insert into academy_identity.mappings(issuer,subject,user_id) values($1,$2,$3)', [issuer, oid, original]);
    const result = (await db.query('select public.academy_identity_resolve_user($1,$2,$3,$4,$5) result', [issuer, oid, 'attacker@example.test', false, 'Name'])).rows[0].result as { id: string; email: string };
    expect(result.id).toBe(original);
    expect(result.email).toBe('existing@example.test');
  });
  it('does not auto-link a second identity even if it presents the same verified email', async () => {
    await expect(db.query('select public.academy_identity_resolve_user($1,$2,$3,$4,$5)', [issuer, '33333333-3333-4333-8333-333333333333', 'existing@example.test', true, 'Another'])).rejects.toThrow('Identity mapping required');
    const count = await db.query('select count(*)::int count from academy_identity.mappings');
    expect(count.rows[0].count).toBe(1);
  });
  it('does not retain an unverified email or grant access to its alleged owner', async () => {
    const result = (await db.query('select public.academy_identity_resolve_user($1,$2,$3,$4,$5) result', [issuer, '44444444-4444-4444-8444-444444444444', 'existing@example.test', false, 'New learner'])).rows[0].result as { id: string; email: null };
    expect(result.id).not.toBe(original);
    expect(result.email).toBeNull();
    expect((await db.query('select id from public.profiles where id=$1', [result.id])).rows).toHaveLength(1);
  });
  it('revokes sessions and rejects stale credential rotations', async () => {
    const hash = 's'.repeat(64);
    await db.query('select public.academy_identity_create_session($1,$2,$3,$4,$5,$6,$7,$8)', [hash, original, issuer, oid, 'pairwise-sub', new Date(Date.now() + 3600000).toISOString(), new Date(Date.now() + 1800000).toISOString(), 'encrypted']);
    expect((await db.query('select public.academy_identity_claim_refresh($1,$2,$3) result', [hash, 1, 'a'.repeat(43)])).rows[0].result).toBe(true);
    const args = [hash, 1, new Date(Date.now() + 2000000).toISOString(), 'rotated', 'a'.repeat(43)];
    expect((await db.query('select public.academy_identity_rotate_session($1,$2,$3,$4,$5) result', args)).rows[0].result).toBe(true);
    expect((await db.query('select public.academy_identity_rotate_session($1,$2,$3,$4,$5) result', args)).rows[0].result).toBe(false);
    await db.query('select public.academy_identity_delete_session($1,$2)', [hash, 1]);
    expect((await db.query('select public.academy_identity_read_session($1) result', [hash])).rows[0].result).not.toBeNull();
    await db.query('select public.academy_identity_delete_session($1)', [hash]);
    expect((await db.query('select public.academy_identity_read_session($1) result', [hash])).rows[0].result).toBeNull();
  });
  it('fences expired refresh owners from rotating, revoking or releasing a successor lease', async () => {
    const hash='f'.repeat(64), oldLease='a'.repeat(43), newLease='b'.repeat(43);
    await db.query('select public.academy_identity_create_session($1,$2,$3,$4,$5,$6,$7,$8)',[hash,original,issuer,oid,'pairwise-sub',new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+1800000).toISOString(),'encrypted']);
    expect((await db.query('select public.academy_identity_claim_refresh($1,$2,$3) result',[hash,1,oldLease])).rows[0].result).toBe(true);
    expect((await db.query('select public.academy_identity_claim_refresh($1,$2,$3) result',[hash,1,newLease])).rows[0].result).toBe(false);
    await db.query("update academy_identity.sessions set refresh_lease_until=clock_timestamp()-interval '1 second' where token_hash=$1",[hash]);
    // Expiration alone fences an old worker, even before any successor claim.
    expect((await db.query('select public.academy_identity_revoke_refresh($1,$2,$3) result',[hash,1,oldLease])).rows[0].result).toBe(false);
    expect((await db.query('select public.academy_identity_claim_refresh($1,$2,$3) result',[hash,1,newLease])).rows[0].result).toBe(true);
    expect((await db.query('select public.academy_identity_release_refresh($1,$2,$3) result',[hash,1,oldLease])).rows[0].result).toBe(false);
    expect((await db.query('select public.academy_identity_revoke_refresh($1,$2,$3) result',[hash,1,oldLease])).rows[0].result).toBe(false);
    const rotate=[hash,1,new Date(Date.now()+2000000).toISOString(),'new-cipher',oldLease];
    expect((await db.query('select public.academy_identity_rotate_session($1,$2,$3,$4,$5) result',rotate)).rows[0].result).toBe(false);
    expect((await db.query('select public.academy_identity_rotate_session($1,$2,$3,$4,$5) result',[...rotate.slice(0,4),newLease])).rows[0].result).toBe(true);
    const row=(await db.query('select public.academy_identity_read_session($1) result',[hash])).rows[0].result as {version:number;refresh_ciphertext:string;refresh_lease:string|null};
    expect(row.version).toBe(2);expect(row.refresh_ciphertext).toBe('new-cipher');expect(row.refresh_lease).toBeNull();
  });
  it('admits Microsoft only for a prelinked active staff identity and rechecks existing sessions',async()=>{
    const workforce='https://login.microsoftonline.com/157419c9-2de9-45e7-a6f9-91546dbef629/v2.0';
    const staffOid='66666666-6666-4666-8666-666666666666';
    expect((await db.query('select public.academy_identity_find_staff($1,$2) result',[workforce,staffOid])).rows[0].result).toBeNull();
    await db.query('insert into academy_identity.mappings(issuer,subject,user_id) values($1,$2,$3)',[workforce,staffOid,original]);
    expect((await db.query('select public.academy_identity_find_staff($1,$2) result',[workforce,staffOid])).rows[0].result).toBeNull();
    await db.query("insert into public.role_assignments(user_id,role_definition_id) values($1,'central_editor')",[original]);
    expect((await db.query('select public.academy_identity_find_staff($1,$2) result',[workforce,staffOid])).rows[0].result).toMatchObject({id:original});
    expect((await db.query('select public.academy_identity_find_staff($1,$2) result',[issuer,oid])).rows[0].result).toBeNull();
    const hash='m'.repeat(64);
    await db.query('select public.academy_identity_create_session($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash,original,workforce,staffOid,'microsoft-pairwise',new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+1800000).toISOString(),'encrypted','microsoft']);
    expect((await db.query('select public.academy_identity_read_session($1) result',[hash])).rows[0].result).toMatchObject({provider:'microsoft'});
    await db.query("update public.user_accounts set status='suspended',suspended_at=now() where user_id=$1",[original]);
    expect((await db.query('select public.academy_identity_read_session($1) result',[hash])).rows[0].result).toBeNull();
    await db.query("update public.user_accounts set status='active',suspended_at=null where user_id=$1",[original]);
    await db.query("delete from public.role_assignments where user_id=$1 and role_definition_id='central_editor'",[original]);
    expect((await db.query('select public.academy_identity_read_session($1) result',[hash])).rows[0].result).toBeNull();
    expect((await db.query('select public.academy_identity_delete_session($1) result',[hash])).rows[0].result).toBe('microsoft');
    await expect(db.query('select public.academy_identity_create_session($1,$2,$3,$4,$5,$6,$7,$8,$9)',['n'.repeat(64),original,workforce,staffOid,'microsoft-pairwise',new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+1800000).toISOString(),'encrypted','microsoft'])).rejects.toThrow('Staff identity required');
  });
  it.each(['disabled_at','deleted_at'])('blocks %s identities without creating a replacement UUID',async column=>{
    await db.query(`update academy_identity.users set ${column}=now() where id=$1`,[original]);
    try {
      expect((await db.query('select public.academy_identity_find_user($1,$2) result',[issuer,oid])).rows[0].result).toBeNull();
      await expect(db.query('select public.academy_identity_resolve_user($1,$2,$3,$4,$5)',[issuer,oid,'new@example.test',true,'New'])).rejects.toThrow('Identity is disabled');
      await expect(db.query('select public.academy_identity_create_session($1,$2,$3,$4,$5,$6,$7,$8)',['d'.repeat(64),original,issuer,oid,'pairwise',new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+1800000).toISOString(),'cipher'])).rejects.toThrow('Identity mapping missing');
    } finally {await db.query(`update academy_identity.users set ${column}=null where id=$1`,[original]);}
  });
  it('denies all identity mutation and session credential reads to learner tokens', async () => {
    await db.exec('set role authenticated');
    try {
      await expect(db.query('select public.academy_identity_read_session($1)', ['s'.repeat(64)])).rejects.toThrow('permission denied');
      await expect(db.query('select public.academy_identity_resolve_user($1,$2,$3,$4,$5)', [issuer, oid, '', false, ''])).rejects.toThrow('permission denied');
      await expect(db.query('select * from academy_identity.sessions')).rejects.toThrow('permission denied');
      for (const name of ['claim_refresh', 'release_refresh', 'revoke_refresh']) {
        await expect(db.query(`select public.academy_identity_${name}($1,$2,$3)`, ['f'.repeat(64), 1, 'a'.repeat(43)])).rejects.toThrow('permission denied');
      }
    } finally { await db.exec('reset role'); }
  });
});
