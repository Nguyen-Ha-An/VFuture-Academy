// Pure policy: also prefixed to the self-contained migration bootstrap by Bicep.
export function isArchiveMetadataPath(path){
  return String(path).split(/[\\/]/).some(part=>part.startsWith('._')||part==='__MACOSX'||part==='.DS_Store');
}
const migrationFiles=new Set([
  'scripts/azure-core/cutover.mjs','build/azure-core/private/cutover-manifest.json',
  'package.json','infra/azure-core/migration/probe.mjs','infra/azure-core/postgres-roots.crt',
  'scripts/azure-core/migrate.mjs','scripts/azure-core/target.mjs','scripts/azure-core/diagnostics.mjs',
  'scripts/azure-core/configure-authenticator.mjs','scripts/azure-core/restore.mjs','scripts/azure-core/schema.mjs',
  'scripts/azure-core/snapshot.mjs','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql',
  'scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql',
  'src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','build/azure-core/private/source-snapshot.json'
]);
export function validateArchiveListing(listing,{kind='migration'}={}){
  if(typeof listing!=='string'||!['migration','functions'].includes(kind))throw new Error('invalid_archive_listing');
  let files=0;
  for(const original of listing.split('\n')){
    if(!original)continue;
    if(/[\x00-\x1f\x7f\\]/.test(original)||original.startsWith('/')||/^[a-z]:/i.test(original)||isArchiveMetadataPath(original))throw new Error('unsafe_archive_member');
    const path=original.replace(/^\.\//,'').replace(/\/$/,'');
    if(!path||path==='.')continue;
    const parts=path.split('/');if(parts.some(part=>!part||part==='.'||part==='..'))throw new Error('unsafe_archive_member');
    const directory=original.endsWith('/');
    const vendor=path==='node_modules'||path.startsWith('node_modules/');
    let allowed=vendor;
    if(kind==='migration'){
      allowed ||= migrationFiles.has(path)||/^supabase\/migrations\/(?:\d{4}|\d{14})_[a-z][a-z0-9_]*\.sql$/.test(path);
      if(directory)allowed ||= [...migrationFiles].some(file=>file.startsWith(path+'/'))||['supabase','supabase/migrations'].includes(path);
    }else{
      allowed ||= ['host.json','package.json','package-lock.json'].includes(path)||path==='src'||path.startsWith('src/');
    }
    if(!allowed)throw new Error('unexpected_archive_member');
    if(!directory)files++;
  }
  if(!files)throw new Error('empty_archive');
  return{files};
}

export function tarListingArguments(archive,version){
  // libarchive otherwise absorbs AppleDouble even in list mode; GNUtar exposes members directly.
  return ['-tzf',archive,...(/bsdtar|libarchive/i.test(version)?['--options','!mac-ext']:[])];
}
