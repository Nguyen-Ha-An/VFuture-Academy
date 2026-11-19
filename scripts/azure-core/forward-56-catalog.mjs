import { canonical, sha256 } from './forward-artifact.mjs';

const schemas = ['public', 'private', 'academy_private', 'academy_identity', 'auth'];
export async function configureCatalogSession(db) {
  // PostgreSQL's deparsers consult session preferences. Set them in this
  // transaction only, including before the historical postcondition queries.
  await db.query(`set local search_path = public;
    set local quote_all_identifiers = off;
    set local intervalstyle = 'postgres';
    set local datestyle = 'ISO, MDY';
    set local timezone = 'UTC';
    set local extra_float_digits = 3;
    set local bytea_output = 'hex';
    set local standard_conforming_strings = on`);
}
// Hash whole routine families and whole relations. A new overload, permissive
// policy, grant, disabled trigger, or invalid index changes that object's hash.
// PostgreSQL emits only object names and digests. No application rows are read.
const routines = `
  select 'routine ' || n.nspname || '.' || p.proname as name,
    encode(sha256(convert_to(jsonb_agg(jsonb_build_array(
      pg_get_functiondef(p.oid), p.proowner::regrole::text,
      array(select acl::text from unnest(coalesce(p.proacl, acldefault('f',p.proowner))) acl order by acl::text collate "C"),
      has_function_privilege('anon',p.oid,'execute'), has_function_privilege('authenticated',p.oid,'execute'),
      has_function_privilege('service_role',p.oid,'execute')
    ) order by pg_get_function_identity_arguments(p.oid) collate "C")::text,'UTF8')),'hex') as digest
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname=any($1::text[]) and p.prokind in ('f','p')
    and ($2::text[] is null or ('routine ' || n.nspname || '.' || p.proname)=any($2::text[]))
  group by n.nspname,p.proname`;
const relations = `
  select 'relation ' || n.nspname || '.' || c.relname as name,
    encode(sha256(convert_to(jsonb_build_array(
      c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text,c.reloptions,
      array(select acl::text from unnest(coalesce(c.relacl, acldefault('r',c.relowner))) acl order by acl::text collate "C"),
      array(select has_table_privilege(role_name,c.oid,privilege) from unnest(array['anon','authenticated','service_role']) role_name
        cross join unnest(array['select','insert','update','delete','truncate','references','trigger']) privilege
        order by role_name collate "C",privilege collate "C"),
      case when c.relkind in ('v','m') then pg_get_viewdef(c.oid) end,
      (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
          a.attidentity,a.attgenerated,col.collname,pg_get_expr(d.adbin,d.adrelid),a.attacl) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        left join pg_collation col on col.oid=a.attcollation
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      (select jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated)
        order by k.conname collate "C") from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),
      (select jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready)
        order by pg_get_indexdef(i.indexrelid) collate "C") from pg_index i where i.indrelid=c.oid),
      (select jsonb_agg(jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled)
        order by t.tgname collate "C") from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
      (select jsonb_agg(jsonb_build_array(p.polname,p.polpermissive,p.polcmd,
          array(select (case when role_id=0 then 'PUBLIC' else role_id::regrole::text end) collate "C" as role_name
            from unnest(p.polroles) role_id order by role_name),
          pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
        order by p.polname collate "C") from pg_policy p where p.polrelid=c.oid)
    )::text,'UTF8')),'hex') as digest
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname=any($1::text[]) and c.relkind in ('r','p','v','m')
    and ($2::text[] is null or ('relation ' || n.nspname || '.' || c.relname)=any($2::text[]))`;

export async function readRepairCatalog(db, names = null) {
  await configureCatalogSession(db);
  const rows = (await db.query(routines, [schemas, names])).rows;
  rows.push(...(await db.query(relations, [schemas, names])).rows);
  return Object.fromEntries(rows.map(row => [row.name, row.digest]));
}
export function deriveCatalogContract(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(name => before[name] !== after[name]).sort();
  const subset = catalog => Object.fromEntries(names.filter(name => Object.hasOwn(catalog,name)).map(name => [name,catalog[name]]));
  return { names, before: sha256(canonical(subset(before))), after: sha256(canonical(subset(after))) };
}
