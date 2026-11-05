// Disposable local Storage wire simulator. The application, its Storage SDK,
// reservation RPCs, finalization and inventory observation remain real.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const privateRoot=join(repository,'build/azure-core/private');
const buckets=new Map([['submissions',50*1024*1024],['media',50*1024*1024],['notebooks',10*1024*1024]]);
const TOTAL_LIMIT=100*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');

async function assertFixtureDatabase(db) {
  const row=(await db.query("select current_database() as database, inet_server_addr() is null as socket_only, current_setting('listen_addresses') as listeners")).rows[0];
  if(!row || row.database!=='academy_route_fixture' || row.socket_only!==true || row.listeners!=='') throw new Error('Storage fixture requires a socket-only academy_route_fixture database');
}

/** Only an empty, socket-only disposable database receives a synthetic empty inventory receipt. */
export async function seedEmptyStorageInventory(db) {
  await assertFixtureDatabase(db);
  const state=(await db.query(`select current_database() as database, inet_server_addr() is null as socket_only,
    current_setting('listen_addresses') as listeners,
    (select count(*)::int from academy_private.storage_objects) as objects,
    (select count(*)::int from academy_private.storage_inventory_receipts) as receipts,
    (select count(*)::int from public.media_upload_reservations) as reservations`)).rows[0];
  if(!state || state.database!=='academy_route_fixture' || state.socket_only!==true || state.listeners!==''
    || state.objects!==0 || state.receipts!==0 || state.reservations!==0) throw new Error('Storage fixture requires an empty socket-only academy_route_fixture database');
  await db.query('insert into academy_private.storage_inventory_receipts(singleton,reconciled_at,object_count,inventory_sha256) values(true,now(),0,$1)',[hash('[]')]);
}

function fail(response,status,message) {
  response.writeHead(status,{'content-type':'application/json'});
  response.end(JSON.stringify({statusCode:String(status),error:status===404?'not_found':'storage_error',message}));
}
function json(response,status,value) { response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value)); }
async function boundedBody(request,maximum) {
  const declared=request.headers['content-length'];
  if(declared!==undefined && (!/^\d+$/.test(declared) || Number(declared)>maximum)) throw new Error('body_limit');
  const chunks=[];let length=0;
  for await(const chunk of request){length+=chunk.length;if(length>maximum)throw new Error('body_limit');chunks.push(chunk);}
  return Buffer.concat(chunks,length);
}
async function objectBody(request) {
  const bytes=await boundedBody(request,8192);
  try {const value=JSON.parse(bytes.toString('utf8'));if(value && typeof value==='object' && !Array.isArray(value))return value;}catch{}
  throw new Error('invalid_json');
}
function objectPath(parts) {
  if(parts.length<2 || !buckets.has(parts[0])) throw new Error('invalid_path');
  const bucket=parts[0];
  const path=parts.slice(1).map(part=>decodeURIComponent(part));
  if(path.some(part=>!part || part==='.' || part==='..' || /[%/\\\x00-\x1f\x7f]/.test(part)))throw new Error('invalid_path');
  return {bucket,path:path.join('/')};
}
function encodedPath(bucket,path){return [bucket,...path.split('/')].map(encodeURIComponent).join('/');}

/** Handles only /storage/v1 requests already accepted by the local 4451 TLS proxy. */
export async function createStorageFixture({runtime,serviceKey,db}) {
  await assertFixtureDatabase(db);
  const root=realpathSync(privateRoot), realRuntime=realpathSync(runtime);
  if(!realRuntime.startsWith(root+sep) || !/^routing-next-[^/]+$/.test(realRuntime.slice(root.length+1))
    || typeof serviceKey!=='string' || serviceKey.length<32) throw new Error('Invalid private storage fixture location');
  const directory=join(realRuntime,'storage-fixture');await mkdir(directory,{mode:0o700});
  const objects=new Map(),tokens=new Map();let total=0,active=0;
  const key=(bucket,path)=>`${bucket}\u0000${path}`;
  function authorize(request){return request.headers.authorization===`Bearer ${serviceKey}`;}
  function issue(method,bucket,path) {
    for(const [token,entry] of tokens) if(entry.exp<=Math.floor(Date.now()/1000))tokens.delete(token);
    if(tokens.size>=4096)throw new Error('token_limit');
    const exp=Math.floor(Date.now()/1000)+3600;
    const token=`${randomBytes(24).toString('base64url')}.${Buffer.from(JSON.stringify({exp})).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
    tokens.set(token,{method,bucket,path,exp});return token;
  }
  function validateToken(url,method,bucket,path) {
    if(url.searchParams.getAll('token').length!==1 || [...url.searchParams.keys()].some(name=>!['token','download'].includes(name)))return false;
    const entry=tokens.get(url.searchParams.get('token'));
    return !!entry && entry.method===method && entry.bucket===bucket && entry.path===path && entry.exp>Math.floor(Date.now()/1000);
  }
  async function putObject(bucket,path,bytes,mime) {
    const id=key(bucket,path);if(objects.has(id))return false;
    if(!bytes.length || bytes.length>buckets.get(bucket) || total+bytes.length>TOTAL_LIMIT || objects.size>=2048 || !mime || mime.length>200)throw new Error('object_limit');
    const filename=join(directory,hash(id));
    total+=bytes.length;
    try { await writeFile(filename,bytes,{mode:0o600,flag:'wx'}); }
    catch(error) { total-=bytes.length;throw error; }
    objects.set(id,{bucket,path,filename,size:bytes.length,mime,sha256:hash(bytes)});return true;
  }
  async function serveBytes(response,entry,head=false) {
    if(!entry)return fail(response,404,'Object not found');
    const bytes=await readFile(entry.filename);
    if(bytes.length!==entry.size || hash(bytes)!==entry.sha256)throw new Error('object_corrupt');
    response.writeHead(200,{'content-type':entry.mime,'content-length':String(bytes.length),'cache-control':'private, no-store'});
    response.end(head?undefined:bytes);
  }
  async function handle(request,response) {
    const origin=request.headers.origin;
    if(origin && origin!=='https://localhost:4452')return fail(response,403,'Origin denied');
    if(origin){response.setHeader('access-control-allow-origin',origin);response.setHeader('vary','Origin');}
    if(request.method==='OPTIONS'){
      response.writeHead(204,{'access-control-allow-methods':'GET, HEAD, POST, PUT, DELETE, OPTIONS','access-control-allow-headers':'content-type, authorization, apikey, x-upsert, x-client-info','access-control-max-age':'60'});return response.end();
    }
    if(active>=8)return fail(response,503,'Fixture busy');active++;
    try {
      const url=new URL(request.url,'https://localhost:4451');
      if(!url.pathname.startsWith('/storage/v1/'))return fail(response,404,'Not found');
      const parts=url.pathname.slice('/storage/v1/'.length).split('/');
      const method=request.method;
      if(parts[0]==='bucket' && parts.length===2 && method==='GET') {
        if(!authorize(request))return fail(response,403,'Authorization required');
        const maximum=buckets.get(parts[1]);if(!maximum)return fail(response,404,'Bucket not found');
        return json(response,200,{id:parts[1],name:parts[1],public:false,file_size_limit:maximum});
      }
      if(parts[0]!=='object')return fail(response,404,'Not found');
      if(parts[1]==='upload' && parts[2]==='sign') {
        const {bucket,path}=objectPath(parts.slice(3));
        if(method==='POST') {
          if(!authorize(request))return fail(response,403,'Authorization required');
          await objectBody(request);const token=issue('PUT',bucket,path);
          return json(response,200,{url:`/object/upload/sign/${encodedPath(bucket,path)}?token=${token}`});
        }
        if(method==='PUT') {
          if(!validateToken(url,'PUT',bucket,path))return fail(response,403,'Invalid token');
          const bytes=await boundedBody(request,buckets.get(bucket));
          if(!(await putObject(bucket,path,bytes,String(request.headers['content-type']??''))))return fail(response,409,'Object already exists');
          return json(response,200,{Key:`${bucket}/${path}`});
        }
      }
      if(parts[1]==='sign') {
        const {bucket,path}=objectPath(parts.slice(2));
        if(method==='POST') {
          if(!authorize(request))return fail(response,403,'Authorization required');
          await objectBody(request);if(!objects.has(key(bucket,path)))return fail(response,404,'Object not found');
          const token=issue('GET',bucket,path);return json(response,200,{signedURL:`/object/sign/${encodedPath(bucket,path)}?token=${token}`});
        }
        if(method==='GET' || method==='HEAD') {
          if(!validateToken(url,'GET',bucket,path))return fail(response,403,'Invalid token');
          return await serveBytes(response,objects.get(key(bucket,path)),method==='HEAD');
        }
      }
      if(parts[1]==='info' && method==='GET') {
        if(!authorize(request))return fail(response,403,'Authorization required');
        const {bucket,path}=objectPath(parts.slice(2));const entry=objects.get(key(bucket,path));
        if(!entry)return fail(response,404,'Object not found');
        return json(response,200,{name:path,size:entry.size,content_type:entry.mime,metadata:{size:entry.size,mimetype:entry.mime}});
      }
      if(parts[1]==='copy' && method==='POST') {
        if(!authorize(request))return fail(response,403,'Authorization required');
        const body=await objectBody(request);const source=objectPath([body.bucketId,...String(body.sourceKey??'').split('/')]);
        const destination=objectPath([body.destinationBucket??body.bucketId,...String(body.destinationKey??'').split('/')]);
        const entry=objects.get(key(source.bucket,source.path));if(!entry)return fail(response,404,'Object not found');
        if(!(await putObject(destination.bucket,destination.path,await readFile(entry.filename),entry.mime)))return fail(response,409,'Object already exists');
        return json(response,200,{Key:`${destination.bucket}/${destination.path}`});
      }
      if(parts[1]==='list' && parts.length===3 && method==='POST') {
        if(!authorize(request))return fail(response,403,'Authorization required');
        const bucket=parts[2];if(!buckets.has(bucket))return fail(response,404,'Bucket not found');
        const body=await objectBody(request);const prefix=typeof body.prefix==='string'?body.prefix:'';
        const checkedPrefix=prefix.endsWith('/')?prefix.slice(0,-1):prefix;
        if(checkedPrefix && objectPath([bucket,...checkedPrefix.split('/')]).path!==checkedPrefix)return fail(response,400,'Invalid prefix');
        const limit=Math.min(1000,Math.max(0,Number.isSafeInteger(body.limit)?body.limit:100));
        const offset=Math.max(0,Number.isSafeInteger(body.offset)?body.offset:0);
        const list=[...objects.values()].filter(entry=>entry.bucket===bucket && entry.path.startsWith(prefix)).sort((a,b)=>a.path.localeCompare(b.path)).slice(offset,offset+limit);
        return json(response,200,list.map(entry=>({name:entry.path.slice(prefix.length).replace(/^\//,''),metadata:{size:entry.size,mimetype:entry.mime}})));
      }
      if(parts.length===2 && method==='DELETE') {
        if(!authorize(request))return fail(response,403,'Authorization required');
        const bucket=parts[1];if(!buckets.has(bucket))return fail(response,404,'Bucket not found');
        const body=await objectBody(request);if(!Array.isArray(body.prefixes) || body.prefixes.length>100)return fail(response,400,'Invalid paths');
        for(const raw of body.prefixes) {
          if(typeof raw!=='string')return fail(response,400,'Invalid paths');
          const {path}=objectPath([bucket,...raw.split('/')]);const entry=objects.get(key(bucket,path));
          if(entry){await rm(entry.filename);objects.delete(key(bucket,path));total-=entry.size;}
        }
        return json(response,200,[]);
      }
      const {bucket,path}=objectPath(parts.slice(1));
      if(!authorize(request))return fail(response,403,'Authorization required');
      if(method==='GET' || method==='HEAD')return await serveBytes(response,objects.get(key(bucket,path)),method==='HEAD');
      if(method==='POST') {
        const bytes=await boundedBody(request,buckets.get(bucket));
        if(!(await putObject(bucket,path,bytes,String(request.headers['content-type']??''))))return fail(response,409,'Object already exists');
        return json(response,200,{Key:`${bucket}/${path}`,Id:hash(key(bucket,path))});
      }
      return fail(response,404,'Not found');
    } catch { if(!response.headersSent)fail(response,400,'Invalid storage fixture request');else response.destroy(); }
    finally {active--;}
  }
  return {handle};
}
