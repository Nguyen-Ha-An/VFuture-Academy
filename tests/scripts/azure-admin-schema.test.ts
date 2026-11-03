import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const runtime=process.env.PGLITE_MODULE_PATH;
type Database={exec(sql:string):Promise<unknown>;query(sql:string,args?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;close():Promise<void>};
describe.skipIf(!runtime)('Azure account administration SQL',()=>{
 let db:Database;
 const admin='11111111-1111-4111-8111-111111111111',learner='22222222-2222-4222-8222-222222222222',second='33333333-3333-4333-8333-333333333333';
 const issuer='https://f3152aa5-61de-40fd-bb76-780b9fbe5428.ciamlogin.com/f3152aa5-61de-40fd-bb76-780b9fbe5428/v2.0';
 const lease='44444444-4444-4444-8444-444444444444',operation='55555555-5555-4555-8555-555555555555';
 const call=async(actor:string,phase:string,input:Record<string,unknown>)=>(await db.query('select public.academy_admin_account($1,$2,$3) result',[actor,phase,input])).rows[0].result as Record<string,unknown>;
 beforeAll(async()=>{
  const {PGlite}=await import(/* @vite-ignore */ pathToFileURL(resolve(runtime!,'dist/index.js')).href);
  const {pgcrypto}=await import(/* @vite-ignore */ pathToFileURL(resolve(runtime!,'dist/contrib/pgcrypto.js')).href);
  const {buildAzureSchema}=await import('../../scripts/azure-core/schema.mjs');db=new PGlite({extensions:{pgcrypto}});await db.exec(buildAzureSchema().sql);
  await db.query('insert into academy_identity.users(id,email) values($1,$2),($3,$4),($5,$6)',[admin,'admin@example.test',learner,'learner@example.test',second,'second@example.test']);
  await db.query("insert into public.role_assignments(user_id,role_definition_id,branch_id) values($1,'central_admin',null)",[admin]);
  await db.query('insert into academy_identity.mappings values($1,$2,$2,now())',[issuer,learner]);
 },30000);
 afterAll(async()=>{await db?.close();});
 it('denies nonmanagers and self-disable before persisting an operation',async()=>{
  const input={userId:admin,operationId:operation,lease,action:'disable'};
  await expect(call(learner,'begin',input)).rejects.toThrow();await expect(call(admin,'begin',input)).rejects.toThrow();
  expect((await db.query('select * from academy_identity.admin_account_operations')).rows).toHaveLength(0);
 });
 it('revokes sessions immediately and fences concurrent operations, then supports retry',async()=>{
  await db.query('select public.academy_identity_create_session($1,$2,$3,$2,$4,$5,$6,$7)',['s'.repeat(64),learner,issuer,'pairwise',new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+1800000).toISOString(),'encrypted']);
  const input={userId:learner,operationId:operation,lease,action:'disable'};
  const result=await call(admin,'begin',input);expect(result.subject).toBe(learner);
  expect((await db.query('select * from academy_identity.sessions where user_id=$1',[learner])).rows).toHaveLength(0);
  expect((await db.query('select disabled_at from academy_identity.users where id=$1',[learner])).rows[0].disabled_at).not.toBeNull();
  await expect(call(admin,'begin',input)).rejects.toThrow();
  await call(admin,'fail',input);
  expect((await call(admin,'read',{userId:learner})).operation).toMatchObject({id:operation,retryRequired:true});
  await call(admin,'begin',{...input,action:'retry'});await call(admin,'complete',input);
  expect((await call(admin,'read',{userId:learner})).status).toBe('disabled');
 });
 it('deletes login while retaining UUID, profile, mapping and audit evidence',async()=>{
  const input={userId:learner,operationId:'66666666-6666-4666-8666-666666666666',lease,action:'delete',confirmation:'DELETE LOGIN'};
  await call(admin,'begin',input);await call(admin,'complete',input);
  expect((await call(admin,'read',{userId:learner})).status).toBe('deleted');
  expect((await db.query('select * from public.profiles where id=$1',[learner])).rows).toHaveLength(1);
  expect((await db.query('select * from academy_identity.mappings where user_id=$1',[learner])).rows).toHaveLength(1);
  expect((await db.query("select * from public.audit_log where target_id=$1 and action='user.account.delete.completed'",[learner])).rows).toHaveLength(1);
  await expect(call(admin,'begin',{...input,action:'enable',operationId:'77777777-7777-4777-8777-777777777777'})).rejects.toThrow();
 });
 it('prevents a custom member manager from disabling the final Central Admin',async()=>{
  await db.query("insert into public.role_definitions(id,name,description,scope_kind,permissions,built_in) values('account_manager','Account manager','','central',array['admin.access','member.manage'],false)");
  await db.query("insert into public.role_assignments(user_id,role_definition_id,branch_id) values($1,'account_manager',null)",[second]);
  await expect(call(second,'begin',{userId:admin,operationId:'88888888-8888-4888-8888-888888888888',lease,action:'disable'})).rejects.toThrow(/final global admin/i);
 });
 it('does not grant account lifecycle RPCs or the journal to normal application users',async()=>{
  expect((await db.query("select has_function_privilege('authenticated','public.academy_admin_account(uuid,text,jsonb)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
  expect((await db.query("select has_table_privilege('authenticated','academy_identity.admin_account_operations','SELECT') allowed")).rows[0].allowed).toBe(false);
 });
 it('reserves a new disabled account and enables it only after an explicit object mapping',async()=>{
  const input={operationId:'99999999-9999-4999-8999-999999999999',lease,action:'create',email:'new@example.test',displayName:'New person'};
  const result=await call(admin,'begin',input);expect(result.subject).toBeNull();
  await expect(call(admin,'complete',input)).rejects.toThrow();
  const subject='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await call(admin,'record',{...input,subject});await call(admin,'complete',input);
  expect((await call(admin,'read',{userId:result.userId})).status).toBe('active');
  await call(admin,'begin',{...input,action:'retry'});await call(admin,'complete',input);
  expect((await db.query("select * from public.audit_log where target_id=$1 and action='user.account.create.completed'",[result.userId])).rows).toHaveLength(1);
  expect((await db.query('select user_id from academy_identity.mappings where subject=$1',[subject])).rows[0].user_id).toBe(result.userId);
 });
});
