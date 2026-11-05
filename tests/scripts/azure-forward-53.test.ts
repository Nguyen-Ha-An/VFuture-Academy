import { describe, expect, it } from 'vitest';
import { buildAzureSchema } from '../../scripts/azure-core/schema.mjs';
import { createForward53Executor } from '../../scripts/azure-core/forward-53.mjs';
import { assertForward53Source, captureForward53Source } from '../../scripts/azure-core/forward-53-provenance.mjs';
import { createForward53PackageManifest } from '../../scripts/azure-core/forward-53-package.mjs';

const target={AZURE_TARGET_HOST:'fixture.postgres.database.azure.com',AZURE_DATABASE_URL:'postgres://academy_admin:fixture@fixture.postgres.database.azure.com/academy?sslmode=verify-full'};
const imported='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
const activation='a'.repeat(40);
const built=buildAzureSchema({through:'20261105030000_exam_attachment_bindings.sql'});
const v1=built.receipt.migrations.slice(49,52).map((m,i)=>({filename:m.file,source_sha256:m.sourceSha256,azure_sha256:m.azureSha256,deployment_sha:i===2?activation:null}));
function fixture(){
  const calls:Array<{sql:string;params?:unknown[]}>=[];
  let receipt:Record<string,unknown>|null=null;let partial=false;let roleDigest='abcd';let postValid=true;let failure='';let prior=v1;let mutateRoles=false;
  return {calls,setPrior:(value:typeof v1)=>{prior=value;},setReceipt:(value:Record<string,unknown>|null)=>{receipt=value;},setPartial:()=>{partial=true;},setRoleDigest:(value:string)=>{roleDigest=value;},setPostValid:(value:boolean)=>{postValid=value;},setFailure:(value:string)=>{failure=value;},mutateRoles:()=>{mutateRoles=true;},async query(sql:string,params?:unknown[]){
    calls.push({sql,params});if(failure && sql.includes(failure))throw Object.assign(new Error('secret'),{code:'XX000'});
    if(sql.includes('current_database()'))return {rows:[{database:'academy',username:'academy_admin',version:'170011'}]};
    if(sql.includes('from academy_private.migration_state'))return {rows:[{state:'imported',schema_sha256:imported}]};
    if(sql.includes('from academy_private.canvas_forward_receipts'))return {rows:prior};
    if(sql.includes('role_definitions_protect_built_in'))return {rows:[{n:1}]};
    if(sql.includes('array_send(permissions)'))return {rows:[{id:'central_admin',built_in:true,permissions:['teaching.announcement.manage','teaching.schedule.manage'],permission_bytes:roleDigest},{id:'school_admin',built_in:true,permissions:[],permission_bytes:'00'},{id:'teacher',built_in:true,permissions:['teaching.announcement.manage','teaching.schedule.manage'],permission_bytes:'00'}]};
    if(sql.includes('as v1_boundaries'))return {rows:[{v1_boundaries:true}]};
    if(sql.includes('as receipt_exists'))return {rows:[{receipt_exists:receipt!==null,exam_table:receipt!==null||partial,quiz_table:receipt!==null||partial,function_count:receipt?17:partial?1:0,trigger_count:receipt?6:partial?1:0}]};
    if(sql.includes('from academy_private.assessment_forward_receipt'))return {rows:receipt?[receipt]:[]};
    if(sql.includes('as postconditions'))return {rows:[{postconditions:postValid}]};
    if(sql.includes('create table public.exam_attachment_bindings') && mutateRoles)roleDigest='4321';
    if(sql.includes('insert into academy_private.assessment_forward_receipt'))receipt={filename:params?.[0],source_sha256:params?.[1],azure_sha256:params?.[2],source_commit:params?.[3],source_tree:params?.[4]};
    return {rows:[]};
  }};
}
const source={sourceClean:false,sourceCommit:null,sourceTree:null};
describe('bounded migration 53 forward executor',()=>{
  it('plans read-only and applies only reviewed 53 plus its private receipt',async()=>{
    const db=fixture();const executor=createForward53Executor({db,target,expectedActivationSha:activation,source});
    const plan=await executor.plan();expect(plan.action).toBe('apply');expect(db.calls[0].sql).toBe('begin read only');
    await expect(executor.apply(plan)).resolves.toMatchObject({action:'applied'});
    const sql=db.calls.map(call=>call.sql);expect(sql.some(value=>value.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sql.filter(value=>value.includes('create table public.exam_attachment_bindings'))).toHaveLength(1);
    expect(sql.some(value=>value.includes('update academy_private.migration_state'))).toBe(false);
    expect(sql.some(value=>value.includes("notify pgrst, 'reload schema'"))).toBe(true);expect(sql.at(-1)).toBe('commit');
  });
  it('refuses mismatched V1 activation provenance, partial schema and bad postconditions',async()=>{
    const db=fixture();await expect(createForward53Executor({db,target,expectedActivationSha:'b'.repeat(40),source}).plan()).rejects.toThrow();
    db.setPartial();await expect(createForward53Executor({db,target,expectedActivationSha:activation,source}).plan()).rejects.toThrow();
  });
  it('rejects a modified V1 source or transformed hash even when activation SHA matches',async()=>{
    const db=fixture();db.setPrior([{...v1[0],source_sha256:'0'.repeat(64)},...v1.slice(1)]);
    await expect(createForward53Executor({db,target,expectedActivationSha:activation,source}).plan()).rejects.toThrow('V1 forward receipt mismatch');
  });
  it('rolls back without a 53 receipt when an SQL or postcondition fails',async()=>{
    const db=fixture();const executor=createForward53Executor({db,target,expectedActivationSha:activation,source});const plan=await executor.plan();
    db.setFailure('create table public.exam_attachment_bindings');
    await expect(executor.apply(plan)).rejects.toThrow('Azure forward 53 migration failed');
    expect(db.calls.at(-1)?.sql).toBe('rollback');
  });
  it('rejects a stale role snapshot under lock',async()=>{
    const db=fixture();const executor=createForward53Executor({db,target,expectedActivationSha:activation,source});const plan=await executor.plan();
    db.setRoleDigest('1234');await expect(executor.apply(plan)).rejects.toThrow('Reviewed plan changed');
    expect(db.calls.at(-1)?.sql).toBe('rollback');
  });
  it('rolls back before receipt if migration changes any role permission bytes',async()=>{
    const db=fixture();const executor=createForward53Executor({db,target,expectedActivationSha:activation,source});const plan=await executor.plan();db.mutateRoles();
    await expect(executor.apply(plan)).rejects.toThrow('Role permissions changed during assessment expansion');
    expect(db.calls.at(-1)?.sql).toBe('rollback');expect(db.calls.some(call=>call.sql.startsWith('insert into academy_private.assessment_forward_receipt'))).toBe(false);
  });
  it('rolls back and does not notify when assessment privilege postconditions fail',async()=>{
    const db=fixture();const executor=createForward53Executor({db,target,expectedActivationSha:activation,source});const plan=await executor.plan();db.setPostValid(false);
    await expect(executor.apply(plan)).rejects.toThrow('Assessment postcondition failed');
    expect(db.calls.at(-1)?.sql).toBe('rollback');expect(db.calls.some(call=>call.sql.includes("notify pgrst"))).toBe(false);
  });
  it('returns an idempotent no-op for matching committed 53 checksums',async()=>{
    const db=fixture();const executor=createForward53Executor({db,target,expectedActivationSha:activation,source});
    await executor.apply(await executor.plan());const replay=await executor.plan();expect(replay.action).toBe('noop');
    await expect(executor.apply(replay)).resolves.toMatchObject({action:'noop'});
    expect(db.calls.filter(call=>call.sql.includes('create table public.exam_attachment_bindings'))).toHaveLength(1);
  });
  it('rechecks reviewed source inside the lock and rolls back if it changes before commit',async()=>{
    const db=fixture();const clean={sourceClean:true,sourceCommit:'b'.repeat(40),sourceTree:'c'.repeat(40)};let checks=0;
    const executor=createForward53Executor({db,target,expectedActivationSha:activation,source:clean,
      verifySource:()=>++checks===1?clean:{sourceClean:false,sourceCommit:null,sourceTree:null}});
    const plan=await executor.plan();
    await expect(executor.apply(plan)).rejects.toThrow('Reviewed source changed');
    expect(db.calls.at(-1)?.sql).toBe('rollback');expect(db.calls.some(call=>call.sql.includes('notify pgrst'))).toBe(false);
  });
});
describe('forward 53 packaging provenance',()=>{
  const commit='b'.repeat(40),tree='c'.repeat(40);
  const git=(args:string[])=>args.includes('--show-toplevel')?'/fixture':args.includes('status')?'':args.includes('HEAD^{tree}')?tree:commit;
  it('requires the exact same clean committed checkout for packaging and apply',()=>{
    const reviewed=captureForward53Source({git,cwd:'/fixture'});
    expect(reviewed).toEqual({sourceClean:true,sourceCommit:commit,sourceTree:tree});
    expect(()=>assertForward53Source(reviewed,{git,cwd:'/fixture'})).not.toThrow();
    expect(()=>assertForward53Source(reviewed,{git:(args:string[])=>args.includes('status')?' M source.ts':git(args),cwd:'/fixture'})).toThrow();
    expect(()=>assertForward53Source({...reviewed,sourceTree:'d'.repeat(40)},{git,cwd:'/fixture'})).toThrow();
  });
  it('binds the local package manifest to the reviewed clean tree and exact transformed 53',()=>{
    const source=captureForward53Source({git,cwd:'/fixture'});
    const migration=built.receipt.migrations[52];
    const envelope={action:'forward-53-plan',source,plan:{action:'apply',filename:migration.file,source,activationSha:activation,sourceSha256:migration.sourceSha256,azureSha256:migration.azureSha256,baseline:imported,priorReceiptDigest:'e'.repeat(64),roleDigest:'f'.repeat(64),roleCount:3}};
    const options={v1Evidence:{verified:true,activationSha:activation},provenanceOptions:{git,cwd:'/fixture'}};
    const manifest=createForward53PackageManifest(envelope,options);
    expect(manifest.files.some(file=>file.path==='supabase/migrations/20261105030000_exam_attachment_bindings.sql')).toBe(true);
    expect(()=>createForward53PackageManifest({...envelope,plan:{...envelope.plan,azureSha256:'0'.repeat(64)}},options)).toThrow();
    expect(()=>createForward53PackageManifest(envelope,{...options,provenanceOptions:{git:(args:string[])=>args.includes('status')?' M source.ts':git(args),cwd:'/fixture'}})).toThrow();
    const replay={...envelope,plan:{...envelope.plan,action:'noop',receiptSourceCommit:commit,receiptSourceTree:tree}};
    expect(()=>createForward53PackageManifest(replay,options)).not.toThrow();
    expect(()=>createForward53PackageManifest({...replay,plan:{...replay.plan,receiptSourceCommit:null,receiptSourceTree:null}},options)).toThrow();
  });
});
