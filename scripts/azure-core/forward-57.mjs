import { readFileSync } from 'node:fs';
import { FILES_PILOT_CATALOG_SHA256, FILES_PILOT_FILE, FILES_PILOT_SQL_SHA256 } from '../../infra/azure-core/archive-policy.mjs';
import { canonical, sha256 } from './forward-artifact.mjs';

const table = 'public.resource_files_pilot';
const baselineSha256 = '273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
const allowedTablePrivileges = ['INSERT', 'SELECT', 'UPDATE'];

export function readFilesPilotSql() {
  const sql = readFileSync(new URL('../../supabase/migrations/' + FILES_PILOT_FILE, import.meta.url));
  if (sha256(sql) !== FILES_PILOT_SQL_SHA256) throw new Error('Unreviewed Files pilot SQL');
  return sql.toString('utf8');
}

export async function readFilesPilotCatalog(db) {
  const { rows: [relation] } = await db.query(`
    select c.oid::text as oid, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
      pg_get_userbyid(c.relowner) as owner, c.reloptions,
      (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies,
      (select count(*)::int from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as triggers,
      (select count(*)::int from pg_rewrite r where r.ev_class=c.oid) as rules,
      (select count(*)::int from pg_inherits i where i.inhrelid=c.oid or i.inhparent=c.oid) as inheritance,
      (select count(*)::int from pg_index i where i.indrelid=c.oid) as indexes
    from pg_class c where c.oid=to_regclass($1)
  `, [table]);
  if (!relation) return null;
  const { oid, ...attributes } = relation;
  const { rows: columns } = await db.query(`
    select a.attname, format_type(a.atttypid,a.atttypmod) as type, a.attnotnull, a.attidentity,
      a.attgenerated, a.attisdropped, a.attacl is not null as column_grants,
      pg_get_expr(d.adbin,d.adrelid) as default_value
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=$1::oid and a.attnum>0 order by a.attnum
  `, [oid]);
  const { rows: constraints } = await db.query(`
    select conname, contype, convalidated, pg_get_constraintdef(oid) as definition
    from pg_constraint where conrelid=$1::oid and contype <> 'n' order by conname collate "C"
  `, [oid]);
  const { rows: grants } = await db.query(`
    select coalesce(r.rolname,'PUBLIC') as role, a.privilege_type, a.is_grantable
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    left join pg_roles r on r.oid=a.grantee
    where c.oid=$1::oid and a.grantee<>c.relowner
    order by coalesce(r.rolname,'PUBLIC') collate "C", a.privilege_type collate "C"
  `, [oid]);
  const { rows: [privileges] } = await db.query(`
    select not has_table_privilege('anon', $1::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      and not has_table_privilege('authenticated', $1::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      and not has_any_column_privilege('anon', $1::oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      and not has_any_column_privilege('authenticated', $1::oid, 'SELECT,INSERT,UPDATE,REFERENCES')
      and has_table_privilege('service_role', $1::oid, 'SELECT')
      and has_table_privilege('service_role', $1::oid, 'INSERT')
      and has_table_privilege('service_role', $1::oid, 'UPDATE')
      and not has_table_privilege('service_role', $1::oid, 'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') as exact_privileges
  `, [oid]);
  if (!privileges?.exact_privileges || canonical(grants) !== canonical(allowedTablePrivileges.map(privilege_type =>
    ({ role: 'service_role', privilege_type, is_grantable: false })))) {
    throw new Error('Files pilot access differs from the approved grants');
  }
  return sha256(canonical({ attributes, columns, constraints }));
}

async function inspect(db, targetHost) {
  const { rows: [target] } = await db.query(`
    select current_database() as name, current_user as username,
      current_setting('server_version_num') as version, current_schema() as current_schema,
      (select a.atttypid='text'::regtype and a.attnotnull
        and exists(select 1 from pg_constraint k
          where k.conrelid=a.attrelid and k.contype='p' and k.convalidated and k.conkey=array[a.attnum])
       from pg_attribute a join pg_class c on c.oid=a.attrelid
       where a.attrelid='public.resources'::regclass and a.attname='id' and not a.attisdropped
         and c.relkind='r' and c.relowner=current_user::regrole) as resource_key,
      (select r.rolbypassrls and not r.rolcanlogin and not r.rolsuper
        and not (r.rolcreaterole or r.rolcreatedb or r.rolreplication)
        and has_schema_privilege(r.oid,'public','USAGE')
        and not exists(select 1 from pg_auth_members m where m.member=r.oid)
       from pg_roles r where r.rolname='service_role') as service_role
  `);
  const { rows: imported } = await db.query('select state, schema_sha256 from academy_private.migration_state where singleton');
  if (target?.name !== 'academy' || target.username !== 'academy_admin' || target.current_schema !== 'pg_catalog'
    || !/^17\d{4}$/.test(target.version) || target.resource_key !== true || target.service_role !== true
    || canonical(imported) !== canonical([{ state: 'imported', schema_sha256: baselineSha256 }])) {
    throw new Error('Unexpected Academy Files pilot database baseline');
  }
  const catalogSha256 = await readFilesPilotCatalog(db);
  if (catalogSha256 !== null && catalogSha256 !== FILES_PILOT_CATALOG_SHA256) {
    throw new Error('Existing pilot table differs from the approved catalog');
  }
  return {
    action: catalogSha256 ? 'noop' : 'apply', filename: FILES_PILOT_FILE, sqlSha256: FILES_PILOT_SQL_SHA256,
    targetSha256: sha256(canonical({ targetHost, version: target.version.slice(0, 2), baselineSha256 })), catalogSha256,
  };
}

export function createFilesPilotExecutor({ db, targetHost, verifySource }) {
  const sql = readFilesPilotSql();
  async function transaction(readOnly, work) {
    try {
      await db.query(readOnly ? 'begin isolation level repeatable read read only' : 'begin');
      await db.query("set local search_path=pg_catalog,public");
      await db.query("set local statement_timeout='15000ms'");
      await db.query("set local lock_timeout='5000ms'");
      const result = await work();
      await db.query(readOnly ? 'rollback' : 'commit');
      return result;
    } catch (error) {
      try { await db.query('rollback'); } catch { /* A lost connection rolls back uncommitted work. */ }
      const failure = new Error('Academy Files pilot migration failed');
      if (/^[0-9A-Z]{5}$/.test(error?.code ?? '')) failure.code = error.code;
      throw failure;
    }
  }
  return {
    plan: () => transaction(true, () => inspect(db, targetHost)),
    apply: reviewed => transaction(false, async () => {
      await db.query("select pg_advisory_xact_lock(hashtextextended('academy.canvas.forward.v1',0))");
      await db.query('lock table public.resources, academy_private.migration_state in share row exclusive mode');
      verifySource();
      const current = await inspect(db, targetHost);
      const matching = canonical(current) === canonical(reviewed);
      const verifiedReplay = reviewed?.action === 'apply' && current.action === 'noop'
        && canonical({ ...current, action: 'apply', catalogSha256: null }) === canonical(reviewed);
      if (!matching && !verifiedReplay) throw new Error('Files pilot reviewed plan differs');
      if (current.action === 'apply') await db.query(sql);
      const observed = await inspect(db, targetHost);
      if (observed.targetSha256 !== current.targetSha256 || observed.catalogSha256 !== FILES_PILOT_CATALOG_SHA256) {
        throw new Error('Files pilot catalog validation failed');
      }
      verifySource();
      await db.query("notify pgrst, 'reload schema'");
      return { outcome: current.action === 'apply' ? 'applied' : 'noop', catalogSha256: observed.catalogSha256 };
    }),
  };
}
