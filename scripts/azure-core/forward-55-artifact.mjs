// Fixed migration55 archive contract. No database or cloud client is constructed here.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonical, cleanSource, createBoundedManifest, verifyBoundedArtifact } from './forward-artifact.mjs';
import {validateTeacherCutoverInventory} from './forward-55-inventory.mjs';
import { buildAzureSchema } from './schema.mjs';
export const FORWARD55_FILE='20261106010000_course_teaching_assignments.sql';
export const FORWARD55_FILES=Object.freeze([FORWARD55_FILE,'20261106011000_exam_teaching_scope.sql','20261106020000_teaching_grading_guards.sql','20261106030000_teaching_report_scope.sql','20261106040000_management_teaching_scope.sql']);
export const FORWARD55_BOUNDARY=FORWARD55_FILES[4];
export const FORWARD55_MANIFEST='build/azure-core/private/forward-55-source-manifest.json';
export const FORWARD55_EVIDENCE='build/azure-core/private/forward-55-v1-evidence.json';
export const FORWARD55_PLAN='build/azure-core/private/forward-55-plan.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const canonical55=canonical;
export function forward55SourceFiles(){
 const built=buildAzureSchema({through:FORWARD55_BOUNDARY});
 if(built.receipt.migrations.length!==59||FORWARD55_FILES.some((file,index)=>built.receipt.migrations[54+index]?.file!==file))throw new Error('Unexpected fixed55 inventory');
 return ['scripts/azure-core/forward-artifact.mjs','scripts/azure-core/forward-53.mjs','scripts/azure-core/forward-55.mjs','scripts/azure-core/forward-55-inventory.mjs','scripts/azure-core/forward-55-cli.mjs','scripts/azure-core/forward-53-provenance.mjs','scripts/azure-core/forward-55-package.mjs','scripts/azure-core/forward-55-artifact.mjs','scripts/azure-core/forward-55-job.mjs','scripts/azure-core/target.mjs','scripts/azure-core/schema.mjs','scripts/azure-core/baselines/identity-pre-handles.sql','scripts/azure-core/baselines/identity-post-handles.sql','scripts/azure-core/bootstrap.sql','scripts/azure-core/storage.sql','scripts/azure-core/media-delete.sql','scripts/azure-core/account-access.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','infra/azure-core/postgres-roots.crt','package.json','package-lock.json',...built.receipt.migrations.map(row=>`supabase/migrations/${row.file}`)].sort();
}
export function forward55Evidence(value){
 const keys=['verified','activationSha','predecessor'];
 const receiptKeys=['filename','source_sha256','azure_sha256','identity_sha256','source_commit','source_tree'];
 const predecessor=value?.predecessor;
 if(!value||Object.keys(value).some(key=>!keys.includes(key))||value.verified!==true||!/^[a-f0-9]{40}$/.test(value.activationSha??'')
  ||!predecessor||Object.keys(predecessor).length!==receiptKeys.length||Object.keys(predecessor).some(key=>!receiptKeys.includes(key))
  ||predecessor.filename!=='20261106000000_managed_profile_handles.sql'
  ||!['source_sha256','azure_sha256','identity_sha256'].every(key=>/^[a-f0-9]{64}$/.test(predecessor[key]??''))
  ||!['source_commit','source_tree'].every(key=>/^[a-f0-9]{40}$/.test(predecessor[key]??'')))throw new Error('Exact verified post54 evidence required');
 const built=buildAzureSchema({through:predecessor.filename});
 if(built.receipt.migrations.length!==54||built.receipt.migrations[53].sourceSha256!==predecessor.source_sha256||built.receipt.migrations[53].azureSha256!==predecessor.azure_sha256
  ||predecessor.identity_sha256!==hash(readFileSync(new URL('./baselines/identity-post-handles.sql',import.meta.url))))throw new Error('Post54 source mismatch');
 return value;
}
/** Pure semantic validation shared by local and relocated packaging, before any DB client. */
export function validateForward55ReviewedPlan(envelope,evidence,{entry,source}={}){
 forward55Evidence(evidence);
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(!keys(envelope,['action','source','plan','packageContentSha256','encryptedPackageSha256','sourceManifestSha256'])||envelope.action!=='forward-55-plan'||!cleanSource(envelope.source)
  ||envelope.packageContentSha256!==undefined&&!sha(envelope.packageContentSha256)||envelope.encryptedPackageSha256!==undefined&&!sha(envelope.encryptedPackageSha256)||envelope.sourceManifestSha256!==undefined&&!sha(envelope.sourceManifestSha256))throw new Error('Reviewed forward55 envelope required');
 const plan=envelope.plan;
 validateTeacherCutoverInventory(plan?.teacherCutoverInventory);
 if(!keys(plan,['action','filename','sourceSha256','azureSha256','identitySha256','migrations','predecessor','baseline','activationSha','priorReceiptDigest','teacherCutoverInventory','roleCount','roleDigest','source','receiptSourceCommit','receiptSourceTree'])
  ||!['apply','noop'].includes(plan.action)||plan.filename!==FORWARD55_FILE||plan.baseline!=='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149'
  ||plan.identitySha256!==hash(readFileSync(new URL('../../src/lib/identity/schema.sql',import.meta.url)))
  ||canonical55(plan.predecessor)!==canonical55(evidence.predecessor)||plan.activationSha!==evidence.activationSha||!sha(plan.priorReceiptDigest)||!sha(plan.roleDigest)||!Number.isSafeInteger(plan.roleCount)||plan.roleCount<3
  ||!entry||!Array.isArray(plan.migrations)||plan.migrations.length!==5||plan.migrations.some((row,index)=>!keys(row,['file','sourceSha256','azureSha256'])||row.file!==FORWARD55_FILES[index]||!sha(row.sourceSha256)||!sha(row.azureSha256))||canonical55(plan.migrations)!==canonical55(buildAzureSchema({through:FORWARD55_BOUNDARY}).receipt.migrations.slice(54))
  ||plan.sourceSha256!==entry.sourceSha256||plan.azureSha256!==entry.azureSha256
  ||canonical55(plan.source)!==canonical55(envelope.source)||source&&canonical55(source)!==canonical55(envelope.source))throw new Error('Invalid reviewed forward55 plan');
 if(plan.action==='noop'? !/^[a-f0-9]{40}$/.test(plan.receiptSourceCommit??'')||!/^[a-f0-9]{40}$/.test(plan.receiptSourceTree??'') : Object.hasOwn(plan,'receiptSourceCommit')||Object.hasOwn(plan,'receiptSourceTree'))throw new Error('Invalid teacher assignment receipt provenance');
 return envelope;
}
const release55 = {
  kind: 'forward-55-source-v1', sourceFiles: forward55SourceFiles, validateEvidence: forward55Evidence,
  manifestPath: FORWARD55_MANIFEST, evidencePath: FORWARD55_EVIDENCE, planPath: FORWARD55_PLAN,
  metadata: evidence => ({activationSha: evidence.activationSha, predecessor: evidence.predecessor,
    schemaSha256: buildAzureSchema({through: FORWARD55_BOUNDARY}).receipt.schemaSha256}),
  validatePlan: (plan, evidence, source) => validateForward55ReviewedPlan(plan, evidence,
    {entry: buildAzureSchema({through: FORWARD55_BOUNDARY}).receipt.migrations[54], source}),
};
export function createForward55ArtifactManifest(options) { return createBoundedManifest(release55, options); }
export function verifyForward55Artifact(root) { return verifyBoundedArtifact(release55, root); }
