import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {teacherCutoverInventory,validateTeacherCutoverInventory,TEACHER_CANDIDATE_CAPABILITIES} from '../../../scripts/azure-core/forward-55-inventory.mjs';
import {validateForward55ReviewedPlan,FORWARD55_BOUNDARY} from '../../../scripts/azure-core/forward-55-artifact.mjs';
import {buildAzureSchema} from '../../../scripts/azure-core/schema.mjs';
import {validateTeachingReceipt,validateArchiveListing} from '../archive-policy.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const empty={ordinaryActorCount:0,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:false};
function review(inventory=empty){
 const built=buildAzureSchema({through:FORWARD55_BOUNDARY}).receipt.migrations;
 const old=built[53],entry=built[54],source={sourceClean:true,sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40)};
 const predecessor={filename:old.file,source_sha256:old.sourceSha256,azure_sha256:old.azureSha256,identity_sha256:hash(readFileSync(new URL('../../../scripts/azure-core/baselines/identity-post-handles.sql',import.meta.url))),source_commit:'c'.repeat(40),source_tree:'d'.repeat(40)};
 const evidence={verified:true,activationSha:'e'.repeat(40),predecessor};
 const envelope={action:'forward-55-plan',source,packageContentSha256:'f'.repeat(64),plan:{action:'apply',filename:entry.file,sourceSha256:entry.sourceSha256,azureSha256:entry.azureSha256,identitySha256:hash(readFileSync(new URL('../../../src/lib/identity/schema.sql',import.meta.url))),migrations:built.slice(54),predecessor,baseline:'273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149',activationSha:evidence.activationSha,priorReceiptDigest:'1'.repeat(64),roleCount:3,roleDigest:'2'.repeat(64),teacherCutoverInventory:inventory,source}};
 return {envelope,evidence,entry,source};
}
test('inventory performs one aggregate read before55 without relying on assignment schema and never exports row data',async()=>{
 let sql,params;
 const inventory=await teacherCutoverInventory({query:async(text,values)=>{sql=text;params=values;return {rows:[{ordinaryActorCount:2,eligibleBranchTeacherPairCount:3,activeEnrollmentCourseBranchPairCount:4,ordinaryGlobalActorWithoutMembershipCount:1,email:'NEVER_EXPORT_PRIVATE_EMAIL',user_id:'NEVER_EXPORT_USER_ID'}]};}});
 assert.deepEqual(inventory,{ordinaryActorCount:2,eligibleBranchTeacherPairCount:3,activeEnrollmentCourseBranchPairCount:4,ordinaryGlobalActorWithoutMembershipCount:1,requiresInitialAssignments:true});
 assert.equal(JSON.stringify(inventory).includes('NEVER_EXPORT'),false);
 assert.match(sql,/^with active_ordinary/);assert.doesNotMatch(sql,/\b(insert|update|delete|create|alter|drop)\b/i);
 assert.doesNotMatch(sql,/course_teaching_assignments|course_teaching_groups|public\.teaching_candidate/);
 assert.match(sql,/definition\.built_in/);assert.match(sql,/definition\.id='central_admin'/);assert.match(sql,/definition\.id='school_admin'/);
 assert.match(sql,/admin\.user_id=ordinary\.user_id and admin\.branch_id=branch\.id/);
 assert.match(sql,/select user_id from ordinary_branch_pairs union select user_id from ordinary_global/);
 assert.deepEqual(params[1],[...TEACHER_CANDIDATE_CAPABILITIES]);
 const candidate=readFileSync(new URL('../../../supabase/migrations/20261106010000_course_teaching_assignments.sql',import.meta.url),'utf8').split('create function public.teaching_candidate')[1].split('$$;')[0];
 const actual=[...candidate.matchAll(/'([^']+)'/g)].map(match=>match[1]).filter(value=>value.includes('.'));
 assert.deepEqual(params[1],actual,'Inventory eligibility stays aligned with the finalized SQL candidate contract');
 assert.doesNotThrow(()=>validateArchiveListing('scripts/azure-core/forward-55-inventory.mjs'));
});
test('inventory rejects invalid counts and ambiguous DB result shapes',async()=>{
 for(const rows of [[],[{},{}],[{ordinaryActorCount:-1,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:0}]])await assert.rejects(teacherCutoverInventory({query:async()=>({rows})}));
});
test('local artifact and trusted archive receipt enforce the same strict five-field inventory contract',()=>{
 for(const valid of [empty,{ordinaryActorCount:3,eligibleBranchTeacherPairCount:1,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:1,requiresInitialAssignments:true}]){
  const {envelope,evidence,entry,source}=review(valid);
  assert.doesNotThrow(()=>validateTeacherCutoverInventory(valid));assert.doesNotThrow(()=>validateForward55ReviewedPlan(envelope,evidence,{entry,source}));assert.doesNotThrow(()=>validateTeachingReceipt(envelope,'forward-55-plan'));
 }
 const invalid=[undefined,null,[],{}, {...empty,rows:[]},{...empty,ordinaryActorCount:-1},{...empty,ordinaryActorCount:1.5},{...empty,ordinaryActorCount:'0'},{...empty,eligibleBranchTeacherPairCount:Number.MAX_SAFE_INTEGER+1},{...empty,requiresInitialAssignments:true},{...empty,ordinaryGlobalActorWithoutMembershipCount:1}];
 for(const value of invalid){
  const {envelope,evidence,entry,source}=review(value);envelope.plan.teacherCutoverInventory=value;
  assert.throws(()=>validateTeacherCutoverInventory(value));assert.throws(()=>validateForward55ReviewedPlan(envelope,evidence,{entry,source}));assert.throws(()=>validateTeachingReceipt(envelope,'forward-55-plan'));
 }
});
