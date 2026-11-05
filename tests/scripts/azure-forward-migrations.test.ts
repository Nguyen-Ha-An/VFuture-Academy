import { describe, expect, it } from 'vitest';
import { createForwardExecutor } from '../../scripts/azure-core/forward.mjs';
import { runForwardCli } from '../../scripts/azure-core/forward-cli.mjs';

const target={AZURE_TARGET_HOST:'fixture.postgres.database.azure.com',AZURE_DATABASE_URL:'postgres://academy_admin:fixture@fixture.postgres.database.azure.com/academy?sslmode=verify-full'};
const baseline='273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149';
function dbFixture() {
  const calls:Array<{sql:string;params?:unknown[]}>=[];
  let receipts:Array<Record<string,unknown>>=[];
  let state={announcements:false,schedules:false,revision:false};
  let roleCount=0; let failureToken=''; let baselineValue=baseline; let boundaryOverride:Record<string,boolean>={};
  let triggerEnabled=true; let schemaRoleMutation=false; let activationFault='';
  let roles=[{id:'central_admin',permissions:['admin.access'],built_in:true},{id:'school_admin',permissions:['admin.access'],built_in:true},{id:'teacher',permissions:['admin.access'],built_in:true}];
  return {calls,setTrigger:(value:boolean)=>{triggerEnabled=value;},setRoles:(value:typeof roles)=>{roles=value;},setSchemaRoleMutation:()=>{schemaRoleMutation=true;},setActivationFault:(value:string)=>{activationFault=value;},setBoundary:(value:Record<string,boolean>)=>{boundaryOverride=value;},setRoleCount:(value:number)=>{roleCount=value;},setFailure:(value:string)=>{failureToken=value;},setBaseline:(value:string)=>{baselineValue=value;},receipts:()=>receipts, setReceipts:(value:Array<Record<string,unknown>>)=>{receipts=value;},setState:(value:typeof state)=>{state=value;}, async query(sql:string,params?:unknown[]) {
    calls.push({sql,params});
    if(failureToken && sql.includes(failureToken)) throw Object.assign(new Error('secret postgres://credential@example'),{code:'XX000'});
    if(sql.includes('current_database()')) return {rows:[{database:'academy',username:'academy_admin',version:'170011'}]};
    if(sql.includes("tgname='role_definitions_protect_built_in'")) return {rows:[{n:triggerEnabled?1:0}]};
    if(sql.includes('select id,permissions,built_in,encode(array_send(permissions)')) return {rows:[...roles,...(roleCount?[{id:'custom',permissions:['teaching.schedule.manage'],built_in:false}]:[])].map(role=>({...role,permission_bytes:Buffer.from(JSON.stringify(role.permissions)).toString('hex')}))};
    if(sql.includes('create table public.teaching_announcements')) {state={...state,announcements:true,schedules:true};if(schemaRoleMutation)roles=roles.map(role=>role.id==='teacher'?{...role,permissions:[...role.permissions,'unexpected.permission']}:role);}
    if(sql.includes('add column revision integer')) state={...state,revision:true};
    if(sql.includes('POST-DEPLOY ACTIVATION ONLY')) {
      roles=roles.map(role=>['teacher','central_admin'].includes(role.id)?{...role,permissions:[...role.permissions,'teaching.announcement.manage','teaching.schedule.manage']}:role);
      if(activationFault==='missing') roles=roles.filter(role=>role.id!=='teacher');
      if(activationFault==='duplicate') roles=roles.map(role=>role.id==='teacher'?{...role,permissions:[...role.permissions,'teaching.schedule.manage']}:role);
      if(activationFault==='school') roles=roles.map(role=>role.id==='school_admin'?{...role,permissions:[...role.permissions,'teaching.schedule.manage']}:role);
      if(activationFault==='trigger') triggerEnabled=false;
    }
    if(sql.startsWith('insert into academy_private.canvas_forward_receipts')) receipts.push({filename:params?.[0],source_sha256:params?.[1],azure_sha256:params?.[2],deployment_sha:params?.[3]});
    if(sql.includes('from academy_private.migration_state')) return {rows:[{state:'imported',schema_sha256:baselineValue}]};
    if(sql.includes("column_name='due_at_snapshot'")) return {rows:[{due_present:state.announcements,due_snapshot:state.announcements,late_present:state.announcements,late:state.announcements,revision_column:state.revision,revision_trigger:state.revision,legacy_rpc:false,guarded_rpc:state.revision,rpc_service:state.revision,rpc_authenticated:false,rpc_anon:false,...boundaryOverride}]};
    if(sql.includes('to_regclass(')) return {rows:[{ledger:receipts.length>0,...state}]};
    if(sql.includes('from academy_private.canvas_forward_receipts')) return {rows:receipts};
    return {rows:[]};
  }};
}
describe('bounded Azure forward migration',()=>{
  it('creates a read-only plan for exactly the expansion pair',async()=>{
    const db=dbFixture(); const executor=createForwardExecutor({db,target});
    const plan=await executor.plan('schema');
    expect(plan.action).toBe('apply'); expect(plan.files).toEqual(['20261105000000_teaching_canvas.sql','20261105010000_teaching_announcement_revisions.sql']);
    expect(db.calls[0].sql).toBe('begin read only'); expect(db.calls.at(-1)?.sql).toBe('rollback');
    expect(db.calls.some(({sql})=>/create table|insert into/i.test(sql))).toBe(false);
  });
  it('applies only after a matching plan and atomically locks both migrations and their receipts',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const plan=await executor.plan('schema');await executor.apply('schema',plan);
    const sql=db.calls.map(c=>c.sql);expect(sql).toContain('begin');expect(sql.some(s=>s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(sql.some(s=>s.includes('create table public.teaching_announcements'))).toBe(true);
    expect(sql.some(s=>s.includes('add column revision integer'))).toBe(true);
    expect(sql.filter(s=>s.includes('insert into academy_private.canvas_forward_receipts'))).toHaveLength(2);
    expect(sql.at(-1)).toBe('commit');
  });
  it('refuses activation without matching explicit verified deployment SHA',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});
    await expect(executor.plan('activate')).rejects.toThrow('Expansion receipt required');
    await expect(executor.apply('activate',{}, {reviewedSha:'a'.repeat(40),verifiedSha:'b'.repeat(40)})).rejects.toThrow('Verified deployment required');
    expect(db.calls.some(c=>c.sql==='begin')).toBe(false);
  });
  it('rejects wrong target without leaking connection details',()=>{
    expect(()=>createForwardExecutor({db:dbFixture(),target:{...target,AZURE_TARGET_HOST:'wrong'}})).toThrow('Invalid Azure migration target');
  });
  it('refuses unknown preexisting schema without receipts',async()=>{
    const db=dbFixture();db.setState({announcements:true,schedules:false,revision:false});
    await expect(createForwardExecutor({db,target}).plan('schema')).rejects.toThrow('Unexpected existing schema');
  });
  it('replays complete receipts as a no-op and rejects changed receipt checksums',async()=>{
    const db=dbFixture(); const executor=createForwardExecutor({db,target}); const first=await executor.plan('schema');
    const rows=first.files.map((filename:string,i:number)=>({filename,source_sha256:first.sourceHashes[i],azure_sha256:first.azureHashes[i],deployment_sha:null}));
    db.setReceipts(rows);db.setState({announcements:true,schedules:true,revision:true});
    const replay=await executor.plan('schema');expect(replay.action).toBe('noop');
    expect((await executor.apply('schema',replay)).action).toBe('noop');
    db.setReceipts([{...rows[0],azure_sha256:'bad'},rows[1]]);
    await expect(executor.plan('schema')).rejects.toThrow('Forward receipt mismatch');
  });
  it('fails closed for unverified baseline and custom role permissions',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});db.setBaseline('unrecognized');
    await expect(executor.plan('schema')).rejects.toThrow('Unrecognized imported baseline');
    db.setBaseline(baseline);db.setRoleCount(1);
    await expect(executor.plan('schema')).rejects.toThrow('Existing teaching permissions incompatible');
  });
  it('rolls back the schema transaction and hides raw database errors',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const plan=await executor.plan('schema');db.setFailure('add column revision integer');
    await expect(executor.apply('schema',plan)).rejects.toThrow('Azure forward migration failed');
    expect(db.calls.at(-1)?.sql).toBe('rollback');
  });
  it('refuses a stale reviewed plan after physical state changes',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const plan=await executor.plan('schema');
    db.setState({announcements:true,schedules:false,revision:false});
    await expect(executor.apply('schema',plan)).rejects.toThrow('Unexpected existing schema');
    expect(db.calls.at(-1)?.sql).toBe('rollback');
  });
  it('requires expanded schema and matching deployment attestation for activation',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const first=await executor.plan('schema');
    db.setReceipts(first.files.map((filename:string,i:number)=>({filename,source_sha256:first.sourceHashes[i],azure_sha256:first.azureHashes[i],deployment_sha:null})));
    db.setState({announcements:true,schedules:true,revision:true});
    const activation=await executor.plan('activate');
    await expect(executor.apply('activate',activation,{verified:true,reviewedSha:'a'.repeat(40),verifiedSha:'a'.repeat(40)})).resolves.toEqual({phase:'activate',action:'applied',receiptCount:3});
    const inserts=db.calls.filter(c=>c.sql.includes('insert into academy_private.canvas_forward_receipts'));
    expect(inserts).toHaveLength(1);expect(inserts[0].params?.[3]).toBe('a'.repeat(40));
  });

  it('accepts a serialized read-only plan and revalidates it under the lock',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});
    const plan=JSON.parse(JSON.stringify(await executor.plan('schema')));
    await expect(executor.apply('schema',plan)).resolves.toEqual({phase:'schema',action:'applied',receiptCount:2});
    const lockIndex=db.calls.findIndex(c=>c.sql.includes('pg_advisory_xact_lock'));
    expect(db.calls.findIndex((c,i)=>i>lockIndex && c.sql.includes('from academy_private.migration_state'))).toBeGreaterThan(lockIndex);
  });
  it('rejects custom teaching permission assignments before activation',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target}); const plan=await executor.plan('schema');
    db.setReceipts(plan.files.map((filename:string,i:number)=>({filename,source_sha256:plan.sourceHashes[i],azure_sha256:plan.azureHashes[i],deployment_sha:null})));
    db.setState({announcements:true,schedules:true,revision:true});db.setRoleCount(1);
    await expect(executor.plan('activate')).rejects.toThrow('Existing teaching permissions incompatible');
  });

  it('rejects missing built-in roles and disabled protection before planning',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});
    db.setTrigger(false);await expect(executor.plan('schema')).rejects.toThrow('Built-in role protection unavailable');
    db.setTrigger(true);db.setRoles([{id:'teacher',permissions:[],built_in:true},{id:'central_admin',permissions:[],built_in:true}]);
    await expect(executor.plan('schema')).rejects.toThrow('Required built-in role missing');
  });
  it('rolls back expansion if any custom or built-in permission array changes',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const plan=await executor.plan('schema');
    db.setSchemaRoleMutation();await expect(executor.apply('schema',plan)).rejects.toThrow('Role permissions changed during expansion');
    expect(db.calls.at(-1)?.sql).toBe('rollback');
    expect(db.calls.some(c=>c.sql.startsWith('insert into academy_private.canvas_forward_receipts'))).toBe(false);
  });
  it.each(['missing','duplicate','school','trigger'])('rolls back activation with %s role invariant failure before its receipt',async(fault)=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const first=await executor.plan('schema');
    db.setReceipts(first.files.map((filename:string,i:number)=>({filename,source_sha256:first.sourceHashes[i],azure_sha256:first.azureHashes[i],deployment_sha:null})));
    db.setState({announcements:true,schedules:true,revision:true});const activation=await executor.plan('activate');
    db.setActivationFault(fault);
    await expect(executor.apply('activate',activation,{verified:true,reviewedSha:'a'.repeat(40),verifiedSha:'a'.repeat(40)})).rejects.toThrow();
    expect(db.calls.at(-1)?.sql).toBe('rollback');
    expect(db.calls.some(c=>c.sql.startsWith('insert into academy_private.canvas_forward_receipts'))).toBe(false);
  });
  it('marks schema cache reload only after transactional postconditions',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const plan=await executor.plan('schema');await executor.apply('schema',plan);
    const sql=db.calls.map(c=>c.sql);const reload=sql.findIndex(s=>s.includes("notify pgrst"));
    expect(reload).toBeGreaterThan(sql.findLastIndex(s=>s.startsWith('insert into academy_private.canvas_forward_receipts')));
    expect(sql[reload+1]).toBe('commit');
  });
  it('rejects partial deadline or unguarded RPC schema even with matching receipts',async()=>{
    const db=dbFixture();const executor=createForwardExecutor({db,target});const first=await executor.plan('schema');
    db.setReceipts(first.files.map((filename:string,i:number)=>({filename,source_sha256:first.sourceHashes[i],azure_sha256:first.azureHashes[i],deployment_sha:null})));
    db.setState({announcements:true,schedules:true,revision:true});db.setBoundary({late:false});
    await expect(executor.plan('schema')).rejects.toThrow('Unexpected schema boundary');
    db.setBoundary({legacy_rpc:true});
    await expect(executor.plan('schema')).rejects.toThrow('Unexpected schema boundary');
    db.setBoundary({rpc_authenticated:true});
    await expect(executor.plan('schema')).rejects.toThrow('Unexpected schema boundary');
  });

});


describe('Azure forward CLI contract',()=>{
  it('plans only through a guarded connected client and returns the review envelope',async()=>{
    let connected=false;let closed=false;
    const db={connect:async()=>{connected=true;},end:async()=>{closed=true;}};
    const plan={phase:'schema',action:'apply'};
    const output=await runForwardCli('plan-schema',{env:target,createClient:()=>db,createExecutor:()=>({plan:async()=>plan,apply:async()=>({action:'unused'})})});
    expect(output).toEqual({action:'forward-plan',phase:'schema',plan});expect(connected).toBe(true);expect(closed).toBe(true);
  });
  it('uses only fixed packaged plan and evidence paths and passes verified SHA',async()=>{
    const paths:string[]=[];const sha='a'.repeat(40);let received:unknown;
    const db={connect:async()=>{},end:async()=>{}};
    const read=(path:URL)=>{paths.push(path.pathname);return Buffer.from(JSON.stringify(path.pathname.endsWith('forward-plan.json')?{action:'forward-plan',phase:'activate',plan:{phase:'activate'}}:{rootVerifiedReady:true,reviewedSha:sha,verifiedSha:sha}));};
    const output=await runForwardCli('apply-activate',{env:target,read,createClient:()=>db,createExecutor:()=>({plan:async()=>({}),apply:async(_phase:string,_plan:unknown,evidence:unknown)=>{received=evidence;return {phase:'activate',action:'applied',receiptCount:3};}})});
    expect(paths.map(path=>path.split('/').at(-1))).toEqual(['forward-plan.json','forward-deployment-evidence.json']);
    expect(received).toEqual({verified:true,reviewedSha:sha,verifiedSha:sha});
    expect(output).toEqual({action:'forward-activate',phase:'activate',receiptCount:3,outcome:'applied'});
  });
  it('rejects unverified activation before creating a connection',async()=>{
    let connected=false;
    const read=(path:URL)=>Buffer.from(JSON.stringify(path.pathname.endsWith('forward-plan.json')?{action:'forward-plan',phase:'activate',plan:{phase:'activate'}}:{rootVerifiedReady:false,reviewedSha:'a'.repeat(40),verifiedSha:'a'.repeat(40)}));
    await expect(runForwardCli('apply-activate',{env:target,read,createClient:()=>{connected=true;return {connect:async()=>{},end:async()=>{}};}})).rejects.toThrow('Invalid deployment evidence');
    expect(connected).toBe(false);
  });
});
