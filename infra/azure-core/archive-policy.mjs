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
  'scripts/azure-core/forward.mjs','scripts/azure-core/forward-cli.mjs',
  'build/azure-core/private/forward-plan.json','build/azure-core/private/forward-deployment-evidence.json',
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

// These are fixed job actions, never operator-supplied script paths or CLI arguments.
export const FORWARD_ACTIONS=Object.freeze({
  'forward-plan':Object.freeze({mode:'plan-schema',phase:'schema',resultAction:'forward-plan'}),
  'forward-schema':Object.freeze({mode:'apply-schema',phase:'schema',resultAction:'forward-schema'}),
  'forward-activation-plan':Object.freeze({mode:'plan-activate',phase:'activate',resultAction:'forward-plan'}),
  'forward-activate':Object.freeze({mode:'apply-activate',phase:'activate',resultAction:'forward-activate'}),
});
export function validateForwardReceipt(value,action){
  const selected=Object.hasOwn(FORWARD_ACTIONS,action)?FORWARD_ACTIONS[action]:null;
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const count=value=>Number.isSafeInteger(value)&&[0,2,3].includes(value);
  if(!selected||!object(value)||value.action!==selected.resultAction||value.phase!==selected.phase)throw new Error('invalid_forward_receipt');
  if(selected.resultAction==='forward-plan'){
    const plan=value.plan;
    const files=selected.phase==='schema'?['20261105000000_teaching_canvas.sql','20261105010000_teaching_announcement_revisions.sql']:['20261105020000_teaching_permissions_activation.sql'];
    if(!keys(value,['action','phase','plan'])||!keys(plan,['phase','action','files','sourceHashes','azureHashes','receiptCount','serverMajor','baseline','deploymentSha','roleCount','roleDigest'])||plan.phase!==selected.phase||!['apply','noop'].includes(plan.action)||!count(plan.receiptCount)||!Number.isSafeInteger(plan.roleCount)||plan.roleCount<3||!sha(plan.roleDigest)||plan.serverMajor!==17||!sha(plan.baseline)||!Array.isArray(plan.files)||JSON.stringify(plan.files)!==JSON.stringify(files)||!Array.isArray(plan.sourceHashes)||!Array.isArray(plan.azureHashes)||plan.sourceHashes.length!==files.length||plan.azureHashes.length!==files.length||!plan.sourceHashes.every(sha)||!plan.azureHashes.every(sha)||selected.phase==='activate'&&plan.receiptCount<2||plan.deploymentSha!==undefined&&!/^[a-f0-9]{40}$/.test(plan.deploymentSha))throw new Error('invalid_forward_receipt');
    if(plan.action!==((selected.phase==='schema'?plan.receiptCount>=2:plan.receiptCount===3)?'noop':'apply')||(plan.receiptCount===3)!==Object.hasOwn(plan,'deploymentSha'))throw new Error('invalid_forward_receipt');
  }else if(!keys(value,['action','phase','receiptCount','outcome'])||!['applied','noop'].includes(value.outcome)||!count(value.receiptCount)||value.receiptCount<2||selected.phase==='activate'&&value.receiptCount!==3||value.outcome==='applied'&&value.receiptCount!==(selected.phase==='schema'?2:3))throw new Error('invalid_forward_receipt');
  return value;
}
