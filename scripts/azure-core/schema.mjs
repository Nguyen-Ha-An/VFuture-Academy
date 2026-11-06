import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const hash = text => createHash('sha256').update(text).digest('hex');
const omissions = [
  { file: '0016_completion_effects.sql', text: "insert into storage.buckets (id, name, public)\nvalues ('certificates', 'certificates', false)\non conflict (id) do update set public = excluded.public;", reason: 'Retained private Storage bucket is configured and verified separately.' },
  { file: '0016_completion_effects.sql', text: 'drop policy if exists "certificate PDFs are public" on storage.objects;', reason: 'Retained Storage policies remain on the source storage project.' },
  { file: '20260906065957_notebook_foundation.sql', text: "insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)\nvalues('notebooks','notebooks',false,10485760,array['application/x-ipynb+json','application/json','text/csv'])\non conflict(id) do nothing;", reason: 'Retained private Storage bucket is configured and verified separately.' },
];
/** @type {Array<[string,URL]>} */
const suffixSteps=[
  ['storage.sql',new URL('storage.sql',import.meta.url)],
  ['src/lib/identity/schema.sql',new URL('src/lib/identity/schema.sql',root)],
  ['src/lib/identity/admin-schema.sql',new URL('src/lib/identity/admin-schema.sql',root)],
  ['media-delete.sql',new URL('media-delete.sql',import.meta.url)],
  ['account-access.sql',new URL('account-access.sql',import.meta.url)],
];
const ownedMigrationPattern=/^(?:[0-9]{4}|[0-9]{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
/** Fail closed on packaging metadata and unexpected SQL; never silently skip it.
 * @param {string[]} entries
 */
export function ownedMigrationNames(entries){
  for(const name of entries){
    if(name.startsWith('._')||name==='.DS_Store'||name==='__MACOSX'
      ||(name.toLowerCase().endsWith('.sql')&&!ownedMigrationPattern.test(name)))throw new Error('Unexpected migration directory entry');
  }
  return entries.filter(name=>ownedMigrationPattern.test(name)).sort();
}
function listOwnedMigrationNames(directory){
  const entries=readdirSync(directory,{withFileTypes:true});
  const names=ownedMigrationNames(entries.map(entry=>entry.name));
  const eligible=new Set(names);
  if(entries.some(entry=>eligible.has(entry.name)&&!entry.isFile()))throw new Error('Owned migrations must be regular files');
  return names;
}
/** Exact owned identifiers, also used to filter diagnostic output. */
export function azureSchemaStepNames(){
  return ['bootstrap.sql',...listOwnedMigrationNames(new URL('supabase/migrations/',root)).map(name=>`supabase/migrations/${name}`),...suffixSteps.map(([id])=>id)];
}
/** Build all current migrations unless an explicit historical release boundary is requested.
 * @param {{through?:string}} options
 */
export function buildAzureSchema(options = {}) {
  const migrationDir = new URL('supabase/migrations/', root);
  const owned = listOwnedMigrationNames(migrationDir);
  const boundary = options.through === undefined ? owned.length - 1 : owned.indexOf(options.through);
  if (boundary < 0) throw new Error('Unknown migration boundary');
  const files = owned.slice(0, boundary + 1);
  /** @type {{file:string,sourceSha256:string,azureSha256:string}[]} */
  const migrations = [];
  const receipt = { version: 1, migrations, omissions: omissions.map(({ file, text, reason }) => ({ file, sha256: hash(text), reason })) };
  const steps = [{id:'bootstrap.sql',sql:readFileSync(new URL('bootstrap.sql', import.meta.url), 'utf8')}];
  for (const file of files) {
    const original = readFileSync(new URL(file, migrationDir), 'utf8');
    let sql = original;
    for (const omission of omissions.filter(item => item.file === file)) {
      if (sql.split(omission.text).length !== 2) throw new Error(`Review Azure omission after source drift: ${file}`);
      sql = sql.replace(omission.text, `-- Azure: ${omission.reason}`);
    }
    sql = sql.replaceAll('auth.users', 'academy_identity.users').replaceAll('storage.objects', 'academy_private.storage_objects');
    if (file === '20261025140618_academy_media_upload_reservations.sql') {
      sql = sql.replaceAll('2*q.size_bytes', '2*52428800').replace('used+held+2*n>capacity', 'used+held+2*52428800>capacity');
      // Native signed tokens enforce the verified bucket cap, not declared bytes.
      // Fail closed until a complete actual Storage API inventory has been imported.
      sql = sql.replace('select capacity_bytes into capacity', "if not exists(select 1 from academy_private.storage_inventory_receipts) then raise exception 'UPLOAD_CAPACITY'; end if;\n  select capacity_bytes into capacity");
    }
    if (/\b(?:storage\.|vault\.|net\.|cron\.)/.test(sql)) throw new Error(`Unmapped vendor dependency in ${file}`);
    steps.push({id:`supabase/migrations/${file}`,sql:`-- source: ${file}\n${sql}`});
    receipt.migrations.push({ file, sourceSha256: hash(original), azureSha256: hash(sql) });
  }
  for(const [id,path] of suffixSteps){
    // Released explicit boundaries retain the identity SQL reviewed at that time.
    const historical=options.through!==undefined&&options.through<='20261105030000_exam_attachment_bindings.sql'&&id==='src/lib/identity/schema.sql';
    steps.push({id,sql:readFileSync(historical?new URL('baselines/identity-pre-handles.sql',import.meta.url):path,'utf8')});
  }
  const sql = steps.map(step=>step.sql).join('\n\n');
  return { sql, steps, receipt: { ...receipt, schemaSha256: hash(sql) } };
}

/** Apply owned files in order, preserving one atomic transaction for all DDL.
 * @param {{query:(sql:string)=>Promise<unknown>}} db
 * @param {{steps:Array<{id:string,sql:string}>}} artifact
 */
export async function applyAzureSchema(db,artifact){
  let currentStep=null;
  try{
    await db.query('begin');
    for(const step of artifact.steps){currentStep=step.id;await db.query(step.sql);}
    currentStep=null;
    await db.query('commit');
  }catch(driverError){
    // A connection/protocol failure can make rollback fail too. Preserve the
    // original failing file and SQLSTATE without exposing any raw driver data.
    try{await db.query('rollback');}catch{/* The entire uncommitted connection is discarded by the caller. */}
    const failure=new Error('Azure schema execution failed');
    failure.code=driverError?.code;
    failure.position=driverError?.position;
    failure.schemaStep=currentStep;
    throw failure;
  }
}
