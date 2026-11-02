import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAzureSchema } from '../../scripts/azure-core/schema.mjs';
const runtime=process.env.PGLITE_MODULE_PATH;
describe.skipIf(!runtime)('Azure media deletion SQL contract',()=>{
  let db: {exec:(sql:string)=>Promise<unknown>;query:(sql:string,args?:unknown[])=>Promise<{rows:{result:{state:string};revision:number;n:number;id:string} []}>;close:()=>Promise<void>};
  const actor='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  beforeAll(async()=>{
    const {PGlite}=await import(pathToFileURL(resolve(runtime!,'dist/index.js')).href);
    const {pgcrypto}=await import(pathToFileURL(resolve(runtime!,'dist/contrib/pgcrypto.js')).href);
    db=new PGlite({extensions:{pgcrypto}});
    await db.exec(buildAzureSchema().sql);
    await db.query("insert into academy_identity.users(id,email) values($1,'admin@example.test'),($2,'other@example.test')",[actor,other]);
    await db.query("insert into public.role_assignments(user_id,role_definition_id) values($1,'central_admin')",[actor]);
    await db.query("insert into academy_private.storage_inventory_receipts values(true,now(),0,$1)",['0'.repeat(64)]);
    await db.query("insert into public.courses(id,owner_id) values('media-delete-course',$1)",[actor]);
  },30000);
  afterAll(async()=>{await db?.close();});
  const asset=async(id:string)=>{await db.query("insert into public.media_assets(id,owner_id,bucket,path,mime,size_bytes,purpose) values($1,$2,'media',$1||'.png','image/png',12,'content')",[id,actor]);};
  const begin=(id:string,user=actor)=>db.query("select public.academy_media_delete_begin($1,$2,'central',null) result",[user,id]);
  const finish=(id:string)=>db.query("select public.academy_media_delete_finish($1,$2,'central',null) result",[actor,id]);
  it('persists tombstones, prevents references after begin, and removes only an absent unused asset',async()=>{
    await asset('asset_delete');
    expect((await begin('asset_delete')).rows[0].result.state).toBe('pending');
    await expect(db.query("insert into public.course_drafts(course_id,manifest) values('media-delete-course',$1)",[{nested:[{assetId:'asset_delete'}]}])).rejects.toThrow('MEDIA_PROTECTED');
    await db.query("select public.academy_storage_observe('media','asset_delete.png','{\"size\":12,\"mimetype\":\"image/png\"}')");
    await expect(finish('asset_delete')).rejects.toThrow('MEDIA_BYTES_REMAIN');
    await db.query("select public.academy_storage_observe('media','asset_delete.png',null)");
    expect((await finish('asset_delete')).rows[0].result.state).toBe('deleted');
    expect((await finish('asset_delete')).rows[0].result.state).toBe('deleted');
    expect((await db.query("select count(*)::int n from public.media_assets where id='asset_delete'")).rows[0].n).toBe(0);
    expect((await db.query("select snapshot->>'id' id from academy_private.media_deletion_guards where asset_id='asset_delete'")).rows[0].id).toBe('asset_delete');
    await expect(asset('asset_delete')).rejects.toThrow('MEDIA_PROTECTED');
  });
  it('protects existing draft and historical snapshot references and rejects unauthorized actors',async()=>{
    await asset('asset_referenced');
    await db.query("insert into public.course_drafts(course_id,manifest) values('media-delete-course',$1)",[{assetId:'asset_referenced'}]);
    await expect(begin('asset_referenced')).rejects.toThrow('MEDIA_IN_USE');
    await expect(begin('asset_referenced',other)).rejects.toThrow('Permission denied');
    await asset('asset_historical');
    await db.query("insert into public.cms_content_snapshots(content_type,content_id,revision_key,checksum,ownership_kind,source,dependencies,created_by) values('course','history','v1','hash','central','{}',$1,$2)",[[{kind:'media',id:'asset_historical'}],actor]);
    await expect(begin('asset_historical')).rejects.toThrow('MEDIA_IN_USE');
  });
  it('blocks aliases of a deleting object and denies stale API tokens after account suspension',async()=>{
    await asset('asset_alias');
    await begin('asset_alias');
    await expect(db.query("insert into public.media_assets(id,owner_id,bucket,path,mime,size_bytes,purpose) values('asset_newalias',$1,'media','asset_alias.png','image/png',12,'content')",[actor])).rejects.toThrow('MEDIA_PROTECTED');
    const now=Math.floor(Date.now()/1000);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:other,iss:'academy-server',aud:'academy-data',iat:now,exp:now+60})]);
    await db.exec('set role authenticated;select academy_private.authorize_request();reset role;');
    await db.query('update academy_identity.users set disabled_at=now() where id=$1',[other]);
    await expect(db.exec('select academy_private.authorize_request();')).rejects.toThrow('Inactive application identity');
    await db.query('update academy_identity.users set disabled_at=null where id=$1',[other]);
  });
  it('protects public-endpoint and retained signed Storage URL references including encoded paths',async()=>{
    for(const [suffix,url] of [
      ['public','https://academy.example.test/api/v1/public/media/asset_urlpublic'],
      ['signed','https://example.supabase.co/storage/v1/object/sign/media/asset_urlsigned.png?token=opaque'],
      ['encoded','https://example.supabase.co/storage/v1/object/sign/media/asset_urlencoded%2Epng?token=opaque'],
    ]){
      const id=`asset_url${suffix}`;
      await asset(id);
      await db.query('insert into public.courses(id,owner_id) values($1,$2)',[`url-${suffix}`,actor]);
      await db.query('insert into public.course_drafts(course_id,manifest) values($1,$2)',[`url-${suffix}`,{image:{url}}]);
      await expect(begin(id)).rejects.toThrow('MEDIA_IN_USE');
    }
  });
  it('mutates the shared guard revision for every reference writer, fencing stale transaction snapshots',async()=>{
    const first=(await db.query("select revision from academy_private.media_deletion_guards where asset_id='asset_referenced'")).rows[0].revision;
    await db.query("update public.course_drafts set manifest=$1 where course_id='media-delete-course'",[{one:{assetId:'asset_referenced'},changed:true}]);
    const next=(await db.query("select revision from academy_private.media_deletion_guards where asset_id='asset_referenced'")).rows[0].revision;
    expect(Number(next)).toBeGreaterThan(Number(first));
  });
});
