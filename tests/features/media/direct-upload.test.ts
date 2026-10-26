import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const auth = vi.hoisted(() => ({ authorize: vi.fn(), grant: vi.fn((url: string) => url) }));
vi.mock('@/features/submissions/service', () => ({ authorizeAssignmentUpload: auth.authorize }));
vi.mock('@/features/storage-transfer/grants', () => ({ grantStorageTransferUrl: auth.grant }));
import { parseDirectUploadInput, verifyUploadBytes, reserveDirectUpload, finalizeDirectUpload, cancelDirectUpload, cleanupDirectUploads, type DirectUploadDatabase, type UploadReservation } from '@/features/media/direct-upload';
const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const bytes = new TextEncoder().encode('homework');
const input = { uploadId:id,name:'work.txt',size:bytes.length,mime:'text/plain',checksum:createHash('sha256').update(bytes).digest('hex'),purpose:'submission' as const,courseId:'course',itemId:'item',blockId:null };
const base = (): UploadReservation => ({id,owner_id:owner,asset_id:'asset_01TEST',filename:'work.txt',size_bytes:bytes.length,checksum:input.checksum,mime:'text/plain',purpose:'submission',bucket:'submissions',pending_path:`direct-pending/${owner}/${id}/work.txt`,ready_path:`direct-ready/${owner}/asset_01TEST/work.txt`,request:{...input,name:'work.txt'},state:'reserved',expires_at:new Date(Date.now()+900000).toISOString(),retain_until:new Date(Date.now()+7500000).toISOString(),lease_token:null,released_at:null});
function harness() {
  let row=base(); const objects = new Map<string,Blob>([[row.pending_path,new Blob([bytes])]]);
  const events:string[]=[];
  const database = {
    rpc:vi.fn(async (name:string,args:Record<string,unknown>)=>{
      if(name==='media_upload_cleanup_candidates') return {data:[row],error:null};
      if(args.p_owner!==owner) return {data:null,error:{message:'UPLOAD_NOT_FOUND'}};
      if(name==='media_upload_reserve') return {data:row,error:null};
      events.push(String(args.p_action));
      if(args.p_action==='claim' && row.state!=='ready') row={...row,state:'finalizing',lease_token:id};
      if(args.p_action==='complete') row={...row,state:'ready'};
      if(args.p_action==='retry') row={...row,state:'reserved'};
      if(args.p_action==='cancel') row={...row,state:'cancelled'};
      if(args.p_action==='cleanup') row={...row,lease_token:id};
      return {data:row,error:null};
    }),
    storage:{from:()=>({
      createSignedUploadUrl:vi.fn(async()=>({data:{signedUrl:`https://storage.test/upload?token=e30.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+4*3600})).toString('base64url')}.signature`},error:null})),
      download:vi.fn((path:string)=>({asStream:async()=>({data:objects.get(path)?.stream()??null,error:objects.has(path)?null:{statusCode:404}})})),
      upload:vi.fn(async(path:string,value:Uint8Array)=>{events.push('upload');if(objects.has(path)) return {error:{statusCode:409}}; objects.set(path,new Blob([value as Uint8Array<ArrayBuffer>]));return {error:null};}),
      remove:vi.fn(async(paths:string[])=>{events.push('remove');for(const path of paths) objects.delete(path);return {error:null};}),
    })},
  };
  return {db:database as unknown as DirectUploadDatabase,objects,events,set:(r:Partial<UploadReservation>)=>{row={...row,...r};},rpc:database.rpc};
}
beforeEach(()=>vi.clearAllMocks());
describe('direct upload admission and byte verification',()=>{
  it.each([0,50*1024*1024+1])('rejects invalid size %s',size=>expect(()=>parseDirectUploadInput({...input,size})).toThrow());
  it('retains the 50 MiB general submission boundary',()=>{
    expect(parseDirectUploadInput({...input,size:50*1024*1024}).size).toBe(50*1024*1024);
  });
  it('rejects checksum, extra bucket/path and mismatched extension declarations',()=>{
    expect(()=>parseDirectUploadInput({...input,checksum:'bad'})).toThrow();
    expect(()=>parseDirectUploadInput({...input,path:'other/file'})).toThrow();
    expect(()=>parseDirectUploadInput({...input,mime:'image/png'})).toThrow();
  });
  it('restricts avatar and cover image MIME and strips filename traversal',()=>{
    expect(()=>parseDirectUploadInput({...input,purpose:'avatar'})).toThrow();
    expect(()=>parseDirectUploadInput({...input,purpose:'project_cover'})).toThrow();
    expect(parseDirectUploadInput({...input,name:'../../work.txt'}).name).toBe('work.txt');
  });
  it('hashes bytes independently of a MIME declaration',async()=>{
    await expect(verifyUploadBytes(base(),bytes)).resolves.toEqual({width:null,height:null});
    await expect(verifyUploadBytes(base(),new TextEncoder().encode('changed!'))).rejects.toMatchObject({code:'CHECKSUM_MISMATCH'});
    await expect(verifyUploadBytes(base(),new Uint8Array(0))).rejects.toMatchObject({code:'UPLOAD_SIZE_MISMATCH'});
    const fake=new TextEncoder().encode('<svg>xx</svg>');
    await expect(verifyUploadBytes({...base(),filename:'photo.png',mime:'image/png',size_bytes:fake.length,checksum:createHash('sha256').update(fake).digest('hex')},fake)).rejects.toMatchObject({code:'UNSUPPORTED_MEDIA'});
  });
  it('extracts actual PNG dimensions for an avatar',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a26sAAAAASUVORK5CYII=','base64');
    await expect(verifyUploadBytes({...base(),filename:'photo.png',mime:'image/png',purpose:'avatar',size_bytes:png.length,checksum:createHash('sha256').update(png).digest('hex')},png)).resolves.toEqual({width:1,height:1});
  });
  it('keeps JPEG avatars with dimensions beyond a large EXIF segment',async()=>{
    const jpeg=Buffer.concat([Buffer.from([255,216,255,225,255,255]),Buffer.alloc(65533),Buffer.from([255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217])]);
    await expect(verifyUploadBytes({...base(),filename:'photo.jpg',mime:'image/jpeg',purpose:'avatar',size_bytes:jpeg.length,checksum:createHash('sha256').update(jpeg).digest('hex')},jpeg)).resolves.toEqual({width:3,height:2});
  });
  it('requires current assignment authorization before reserving bytes',async()=>{
    const h=harness(); auth.authorize.mockRejectedValueOnce(new Error('assignment forbidden'));
    await expect(reserveDirectUpload(owner,input,h.db)).rejects.toThrow('assignment forbidden');
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('binds a fresh signed grant to exact owner/path/bytes and records actual token expiry',async()=>{
    const h=harness(); const permit=await reserveDirectUpload(owner,input,h.db);
    expect(permit.uploadUrl).toContain('token=');
    expect(auth.grant).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({subject:owner,method:'PUT',bucket:'submissions',path:base().pending_path,maxBytes:8}));
    const signed=h.rpc.mock.calls.find(([,args])=>args.p_action==='signed');
    expect(signed).toBeDefined();
    expect(Date.parse((signed![1].p_extra as {expiresAt:string}).expiresAt)).toBeGreaterThan(Date.now()+3*3600_000);
  });
  it('rechecks current assignment authorization before finalizing',async()=>{
    const h=harness(); auth.authorize.mockRejectedValueOnce(new Error('assignment removed'));
    await expect(finalizeDirectUpload(owner,id,h.db)).rejects.toThrow('assignment removed');
    expect(h.objects.has(base().ready_path)).toBe(false);
  });
  it('rejects cross-owner finalization before inspecting an object',async()=>{
    const h=harness(); await expect(finalizeDirectUpload('other',id,h.db)).rejects.toMatchObject({status:404});
    expect(h.events).toEqual([]);
  });
  it('publishes verified bytes once, returns compatible response and retains pending quarantine',async()=>{
    const h=harness(); const result=await finalizeDirectUpload(owner,id,h.db);
    expect(result).toEqual({assetId:'asset_01TEST',name:'work.txt',size:8,mime:'text/plain'});
    expect(h.objects.has(base().pending_path)).toBe(true);
    expect(h.objects.has(base().ready_path)).toBe(true);
    await expect(finalizeDirectUpload(owner,id,h.db)).resolves.toEqual(result);
    expect(h.events.filter(v=>v==='upload')).toHaveLength(1);
  });
  it('recovers an ambiguous ready upload only after verifying ready bytes',async()=>{
    const h=harness(); h.objects.set(base().ready_path,new Blob([bytes]));
    await expect(finalizeDirectUpload(owner,id,h.db)).resolves.toHaveProperty('assetId');
    const bad=harness(); bad.objects.set(base().ready_path,new Blob(['changed!']));
    await expect(finalizeDirectUpload(owner,id,bad.db)).rejects.toMatchObject({code:'CHECKSUM_MISMATCH'});
    expect(bad.events).not.toContain('complete');
  });
  it('stops reading storage as soon as actual bytes exceed the reservation',async()=>{
    const h=harness(); const cancel=vi.fn(); const tooLarge=new Blob(['123456789']);
    vi.spyOn(tooLarge,'stream').mockReturnValue(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(9));},cancel}));
    h.objects.set(base().pending_path,tooLarge);
    await expect(finalizeDirectUpload(owner,id,h.db)).rejects.toMatchObject({code:'UPLOAD_SIZE_MISMATCH'});
    expect(cancel).toHaveBeenCalledOnce(); expect(h.events).not.toContain('upload');
  });
  it('returns a missing pending upload to reserved so a fresh grant can retry the same id',async()=>{
    const h=harness(); h.objects.clear();
    await expect(finalizeDirectUpload(owner,id,h.db)).rejects.toMatchObject({code:'UPLOAD_NOT_FOUND'});
    expect(h.events).toContain('retry');
  });
  it('does not release quota when storage cleanup fails',async()=>{
    const h=harness(); h.set({state:'cancelled',retain_until:new Date(0).toISOString()});
    const storage=h.db.storage.from('submissions');
    h.db.storage.from=()=>({...storage,remove:async()=>({error:{message:'storage unavailable'}})});
    await expect(cleanupDirectUploads(h.db,1)).resolves.toEqual({inspected:1,cleaned:0});
    expect(h.events).not.toContain('release');expect(h.objects.has(base().pending_path)).toBe(true);
  });
  it('cancel quarantines bytes; cleanup never removes a published ready object',async()=>{
    const h=harness(); await cancelDirectUpload(owner,id,h.db);
    expect(h.objects.has(base().pending_path)).toBe(true);
    h.set({state:'ready',retain_until:new Date(0).toISOString()}); h.objects.set(base().ready_path,new Blob([bytes]));
    await cleanupDirectUploads(h.db,2);
    expect(h.objects.has(base().pending_path)).toBe(false);
    expect(h.objects.has(base().ready_path)).toBe(true);
    expect(h.events.at(-1)).toBe('release');
  });
});
