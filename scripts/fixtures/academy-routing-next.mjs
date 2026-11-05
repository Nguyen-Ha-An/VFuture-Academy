#!/usr/bin/env node
// Local-only real Next/PostgREST/native PostgreSQL stack. This script never downloads binaries.
import { execFileSync,spawn } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import { createServer as httpsServer,request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createServer as portProbe } from 'node:net';
import { appendFileSync,chmodSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,realpathSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverStudioPostgresBinaries,createStudioFixtureClient } from '../lib/studio-postgres-fixture.mjs';
import { buildAzureSchema } from '../azure-core/schema.mjs';
import { seedRoutingDatabase,FIXTURE_DATABASE } from '../../tests/e2e/real-next-harness/seed.mjs';
import { seedQuizUploadFixture } from '../../tests/e2e/real-next-harness/quiz-seed.mjs';
import { createStorageFixture,seedEmptyStorageInventory } from '../../tests/e2e/real-next-harness/storage-fixture.mjs';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const production=process.argv.includes('--production');
for(const file of ['.env','.env.local',`.env.${production?'production':'development'}`,`.env.${production?'production':'development'}.local`])if(existsSync(join(repository,file)))throw new Error('Root dotenv files must be absent from this isolated fixture checkout; inherited deployment configuration is forbidden');
const pgBin=process.env.STUDIO_POSTGRES_BIN??'/tmp/academy-routing-native-pg/node_modules/@embedded-postgres/darwin-arm64/native/bin';
const nativeLib=resolve(pgBin,'../lib');
const postgrest=process.env.ACADEMY_ROUTING_POSTGREST_BIN??'/tmp/academy-routing-postgrest/postgrest';
const binarySha='89559e2f1568c8ae2ad5c73519713a1cf9230581213a2a73c094e600279f7761';
const archiveSha='c0757fa1e59af142d4a0f0fe5eb2f9815a1098498aa64b54971a16a5757660d7';
const archivePath=join(dirname(postgrest),'postgrest.tar.xz');
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('TLS verification must remain enabled');
for(const name of ['initdb','pg_ctl','postgres'])if(!existsSync(join(pgBin,name)))throw new Error('Install the pinned owned native PostgreSQL runtime before launching; no automatic install is allowed');
if(!existsSync(postgrest)||createHash('sha256').update(readFileSync(postgrest)).digest('hex')!==binarySha)throw new Error('PostgREST binary differs from the approved extracted13.0.7 asset');
if(existsSync(archivePath)&&createHash('sha256').update(readFileSync(archivePath)).digest('hex')!==archiveSha)throw new Error('Retained PostgREST archive differs from the approved official asset');
for(const port of [4450,4451,4452,4454])await new Promise((resolvePort,reject)=>{const probe=portProbe();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolvePort));});
process.env.STUDIO_POSTGRES_BIN=pgBin;
const binaries=discoverStudioPostgresBinaries();
if(binaries.temporaryRuntime)throw new Error('Unexpected automatic runtime install');
const cluster=realpathSync(mkdtempSync('/tmp/academy-route.'));
const data=join(cluster,'data'),socket=join(cluster,'socket');mkdirSync(socket,{mode:0o700});
const privateRoot=join(repository,'build/azure-core/private');mkdirSync(privateRoot,{recursive:true,mode:0o700});
const runtime=mkdtempSync(join(privateRoot,'routing-next-'));
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>['PATH','HOME','TMPDIR','LANG','LC_ALL','TERM','SystemRoot'].includes(key)));
const nativeEnv={...cleanEnv,TZ:'UTC',DYLD_LIBRARY_PATH:nativeLib};
const invoke=(name,args)=>execFileSync(join(binaries.bin,name),args,{env:nativeEnv,stdio:['ignore','pipe','pipe'],encoding:'utf8'});
const children=[],servers=[];
let stopping=false,db,fixtureStorage;
async function cleanup(){
  if(stopping)return;stopping=true;
  for(const server of servers){server.closeAllConnections?.();server.close();}
  for(const child of children)try{process.kill(-child.pid,'SIGTERM');}catch{/* Already stopped. */}
  await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolveStop=>{child.once('exit',resolveStop);setTimeout(resolveStop,5000).unref();})));
  for(const child of children)if(child.exitCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{/* Already stopped. */}
  await db?.end().catch(()=>{});
  if(existsSync(join(data,'postmaster.pid')))invoke('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  rmSync(cluster,{recursive:true,force:true});
  // Keep private manifest/logs for review; all cookies/keys are synthetic and local-only.
}
const interrupted=()=>void cleanup().then(()=>process.exit(0),()=>{console.error('Fixture shutdown failed; owned cluster retained.');process.exit(1);});
const fatal=()=>void cleanup().then(()=>process.exit(1),()=>process.exit(1));
process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
function child(command,args,env,label){
  const log=join(runtime,`${label}.log`);
  const proc=spawn(command,args,{cwd:repository,env,detached:true,stdio:['ignore','pipe','pipe']});children.push(proc);
  const append=chunk=>appendFileSync(log,chunk,{mode:0o600});
  proc.stdout.on('data',append);proc.stderr.on('data',append);
  proc.once('error',()=>{if(!stopping){console.error(`Local ${label} failed; inspect its private log.`);fatal();}});
  proc.once('exit',()=>{if(!stopping){console.error(`Local ${label} exited; inspect its private log.`);fatal();}});
  return proc;
}
function proxy(port,targetPort,{app=false}={}){
  const server=httpsServer({key:readFileSync(join(runtime,'server.key')),cert:readFileSync(join(runtime,'server.crt'))},(request,response)=>{
    if(!app && (request.url==='/storage/v1' || request.url?.startsWith('/storage/v1/'))) {
      void fixtureStorage.handle(request,response).catch(()=>{if(!response.headersSent){response.writeHead(500);response.end('Local storage fixture unavailable');}else response.destroy();});
      return;
    }
    const requestPath=(request.url??'').split('?',1)[0];
    const kind=app && /^\/api\/v1\/exams\/[^/]+\/attempts$/.test(requestPath)
      ? (request.method==='GET'?'session':request.method==='POST'?'start':null)
      : app && /^\/api\/v1\/exams\/attempts\/[^/]+\/answers$/.test(requestPath) && request.method==='PUT' ? 'save'
        : app && /^\/api\/v1\/exams\/attempts\/[^/]+\/(?:review|historical-review)$/.test(requestPath) && request.method==='GET' ? (requestPath.endsWith('/historical-review')?'historical-review':'review')
          : null;
    const started=kind?performance.now():0;
    const upstream=httpRequest({hostname:'127.0.0.1',port:targetPort,path:request.url,method:request.method,headers:{...request.headers,...(app?{host:'localhost:4452','x-forwarded-host':'localhost:4452','x-forwarded-proto':'https','x-forwarded-for':'127.0.0.1'}:{})}},received=>{
      if(kind) {
        let wireBytes=0;
        received.on('data',chunk=>{wireBytes+=chunk.length;});
        received.on('end',()=>appendFileSync(join(runtime,'exam-transport.jsonl'),JSON.stringify({kind,status:received.statusCode??502,wireBytes,
          contentEncoding:typeof received.headers['content-encoding']==='string'?received.headers['content-encoding']:'identity',
          elapsedMs:Math.round((performance.now()-started)*100)/100,timing:'instrumented-proxy-to-upstream-end'})+'\n',{mode:0o600}));
      }
      response.writeHead(received.statusCode??502,received.headers);received.pipe(response);
    });
    upstream.on('error',()=>{if(!response.headersSent){response.writeHead(502);response.end('Local fixture upstream unavailable');}else response.destroy();});request.pipe(upstream);
  });
  if(app)server.on('upgrade',(request,socket,head)=>{
    const upstream=httpRequest({hostname:'127.0.0.1',port:targetPort,path:request.url,headers:{...request.headers,host:'localhost:4452','x-forwarded-proto':'https'}});
    upstream.on('upgrade',(response,peer,buffer)=>{socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`+Object.entries(response.headers).map(([key,value])=>`${key}: ${value}`).join('\r\n')+'\r\n\r\n');if(buffer.length)socket.write(buffer);if(head.length)peer.write(head);peer.pipe(socket);socket.pipe(peer);});
    upstream.on('error',()=>socket.destroy());upstream.end();
  });
  servers.push(server);return new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveListen);});
}
function localRequest(url){
  const endpoint=new URL(url);if(endpoint.protocol!=='https:'||endpoint.hostname!=='localhost'||!['4451','4452'].includes(endpoint.port))throw new Error('Non-loopback fixture URL refused');
  return new Promise((resolveStatus,reject)=>{const request=httpsRequest(endpoint,{family:4,ca:readFileSync(join(runtime,'ca.crt'))},response=>{response.resume();resolveStatus(response.statusCode);});request.on('error',reject);request.setTimeout(10000,()=>request.destroy(new Error('Local readiness timeout')));request.end();});
}
async function ready(url){
  for(let attempt=0;attempt<180;attempt++){if(stopping)throw new Error('Fixture stopped');try{const status=await localRequest(url);if(status<500)return;}catch{/* Startup not complete. */}await new Promise(resolveWait=>setTimeout(resolveWait,500));}
  throw new Error('Local fixture readiness timed out');
}
try{
  const version=execFileSync(postgrest,['--version'],{env:nativeEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(!/\b13\.0\.7\b/.test(version))throw new Error('Unexpected PostgREST version');
  invoke('initdb',['-D',data,'-U','academy_route_admin','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
  invoke('pg_ctl',['-D',data,'-l',join(runtime,'postgres.log'),'-o',`-k ${socket} -p 55447 -c listen_addresses='' -c unix_socket_permissions=0700 -c fsync=off`,'-w','start']);
  const pgConfig={host:socket,port:55447,user:'academy_route_admin',connectionTimeoutMillis:5000};
  const control=createStudioFixtureClient({...pgConfig,database:'postgres'});await control.connect();
  try{if((await control.query('show listen_addresses')).rows[0].listen_addresses!=='')throw new Error('Database must be socket-only');await control.query(`create database ${FIXTURE_DATABASE}`);}finally{await control.end();}
  db=createStudioFixtureClient({...pgConfig,database:FIXTURE_DATABASE});await db.connect();
  if(!/^17\d{4}$/.test((await db.query("select current_setting('server_version_num') as version")).rows[0].version))throw new Error('Native PostgreSQL17 required');
  const schema=buildAzureSchema();if(schema.receipt.migrations.length!==53)throw new Error('Current complete53migration schema required');await db.query(schema.sql);
  const password=randomBytes(32).toString('base64url');await db.query(`alter role academy_authenticator login password '${password}'`);
  const seeded=await seedRoutingDatabase(db,{repository,runtime,production});
  const quizUploadFixture=await seedQuizUploadFixture(db,{repository,runtime,ownerId:seeded.actors.owner.userId,learnerId:seeded.actors.learner.userId});
  await seedEmptyStorageInventory(db);
  const storageKey=randomBytes(32).toString('base64url');
  fixtureStorage=await createStorageFixture({runtime,serviceKey:storageKey,db});
  await db.end();db=null;
  const ssl=(args)=>execFileSync('openssl',args,{env:cleanEnv,stdio:['ignore','pipe','pipe']});
  ssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(runtime,'ca.key'),'-out',join(runtime,'ca.crt'),'-days','1','-subj','/CN=Academy Local Routing Fixture CA']);
  ssl(['req','-new','-newkey','rsa:2048','-nodes','-keyout',join(runtime,'server.key'),'-out',join(runtime,'server.csr'),'-subj','/CN=localhost']);
  writeFileSync(join(runtime,'san.conf'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600});
  ssl(['x509','-req','-in',join(runtime,'server.csr'),'-CA',join(runtime,'ca.crt'),'-CAkey',join(runtime,'ca.key'),'-CAcreateserial','-out',join(runtime,'server.crt'),'-days','1','-extfile',join(runtime,'san.conf')]);
  for(const file of ['ca.key','server.key'])chmodSync(join(runtime,file),0o600);
  const jwt=randomBytes(48).toString('base64url');
  child(postgrest,[],{...nativeEnv,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'4450',PGRST_DB_URI:`postgresql:///${FIXTURE_DATABASE}?host=${encodeURIComponent(socket)}&port=55447&user=academy_authenticator&password=${password}`,PGRST_DB_SCHEMAS:'public',PGRST_DB_PRE_REQUEST:'academy_private.authorize_request',PGRST_JWT_SECRET:jwt,PGRST_JWT_AUD:'academy-data',PGRST_DB_POOL:'4'},'postgrest');
  await proxy(4451,4450);await ready('https://localhost:4451/');
  const nextEnv={...cleanEnv,TZ:'UTC',NODE_ENV:production?'production':'development',NODE_OPTIONS:'--dns-result-order=ipv4first',NODE_EXTRA_CA_CERTS:join(runtime,'ca.crt'),ACADEMY_ROUTING_RUNTIME:runtime,ACADEMY_ROUTING_MODE:production?'production':'development',ACADEMY_BACKEND:'azure',NEXT_PUBLIC_ACADEMY_BACKEND:'azure',NEXT_PUBLIC_SUPABASE_URL:'https://localhost:4451/',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-fixture-public-placeholder',SUPABASE_STORAGE_URL:'https://localhost:4451/',SUPABASE_STORAGE_SERVICE_ROLE_KEY:storageKey,AZURE_POSTGREST_URL:'https://localhost:4451/',AZURE_POSTGREST_JWT_SECRET:jwt,NEXT_PUBLIC_APP_URL:'https://localhost:4452',RATE_LIMIT_COOKIE_SECRET:randomBytes(32).toString('base64url'),ENTRA_SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),ENTRA_TENANT_ID:'30000000-0000-4000-8000-000000000001',ENTRA_CLIENT_ID:'30000000-0000-4000-8000-000000000002',ENTRA_CLIENT_SECRET:randomBytes(32).toString('base64url'),ENTRA_ISSUER:'https://localhost:4452/fixture-identity',ENTRA_AUTHORITY:'https://localhost:4452/fixture-identity',NEXT_TELEMETRY_DISABLED:'1',ACADEMY_BUILD_CACHE:'0'};
  writeFileSync(join(runtime,'next-env.json'),JSON.stringify(nextEnv,null,2)+'\n',{mode:0o600});
  const manifest={kind:'academy-real-next-local',runtime,cluster,appOrigin:'https://localhost:4452',dataOrigin:'https://localhost:4451',ca:join(runtime,'ca.crt'),mode:production?'production':'development',serverTimezone:'UTC',outboundFetchLog:join(runtime,'outbound-fetch.jsonl'),postgres:{...pgConfig,database:FIXTURE_DATABASE},postgrest:{version:'13.0.7',binarySha256:binarySha,officialArchiveSha256:archiveSha,archivePresentVerified:existsSync(archivePath)},schemaSha256:schema.receipt.schemaSha256,...seeded,quizUploadFixture,boundaries:['External Entra sign-in/provisioning is not emulated or proven','Real local server session store, auth and permissions are exercised','Storage bytes are handled by a local bounded simulator; hosted storage is not exercised','Route inventory is not render coverage']};
  writeFileSync(join(runtime,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  if(process.argv.includes('--data-only')){
    console.log(JSON.stringify({status:'local_data_fixture_ready',manifest:join(runtime,'manifest.json'),envFile:join(runtime,'next-env.json'),ca:manifest.ca}));
    await new Promise(()=>{});
  }
  child(process.execPath,[join(repository,'tests/e2e/real-next-harness/next-backend.mjs')],nextEnv,'next');
  await proxy(4452,4454,{app:true});await ready('https://localhost:4452/login');
  console.log(JSON.stringify({status:'local_fixture_ready',origin:manifest.appOrigin,manifest:join(runtime,'manifest.json'),ca:manifest.ca,mode:manifest.mode}));
}catch(error){writeFileSync(join(runtime,'setup-error.json'),JSON.stringify({code:error.code??null,message:error.message,stack:error.stack},null,2)+'\n',{mode:0o600});console.error(JSON.stringify({status:'local_fixture_failed',code:typeof error.code==='string'?error.code:'FIXTURE_SETUP_FAILED',logs:runtime}));await cleanup();process.exitCode=1;}
