// Registration/rejection census only. No authenticated cookie, bearer, cron secret or valid mutation body.
import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync,appendFileSync } from 'node:fs';
import { request } from 'node:https';
import { dirname,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalManifest } from './manifest.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const manifest=readLocalManifest(process.argv[2]);
const inventoryFile=resolve(process.argv[3]??join(root,'docs/design/canvas-refinement/backend-route-audit.json'));
const bytes=readFileSync(inventoryFile),inventory=JSON.parse(bytes);
if(inventory.schemaVersion!==1||!Array.isArray(inventory.routes)||inventory.routes.length!==inventory.counts?.methodPathPairs)throw new Error('Invalid authoritative method inventory');
const unique=new Set();
const missing='90000000-0000-4000-8000-000000000099';
const parameters={assetId:'routing-missing-asset',attemptId:missing,blockId:'routing-missing-block',branchId:manifest.branch,code:'routing-invalid-code',contentId:manifest.courseId,contentType:'course',courseId:manifest.courseId,handle:'routing-missing-handle',id:missing,invitationId:missing,itemId:manifest.itemId,kind:'assignment',questionId:'main/q-match',reviewId:missing,roleId:'routing-missing-role',submissionId:missing,uploadId:missing,userId:missing,v:'1'};
function concrete(pattern){
  if(typeof pattern!=='string'||!pattern.startsWith('/api/'))throw new Error('Non-API inventory path refused');
  const value=pattern.replace(/\[([^\]]+)\]/g,(_match,key)=>{if(!Object.hasOwn(parameters,key))throw new Error('Unmapped dynamic parameter');return encodeURIComponent(parameters[key]);});
  if(value.includes('[')||value.includes(']')||new URL(value,manifest.appOrigin).origin!==manifest.appOrigin)throw new Error('Unsafe concrete inventory path');
  return value;
}
function references(value){
  const found=new Map(),visited=new Set();
  const visit=node=>{if(typeof node==='string'){if(visited.has(node))return;visited.add(node);if(Object.hasOwn(inventory.sourceEvidenceCatalog??{},node))visit(inventory.sourceEvidenceCatalog[node]);if(Object.hasOwn(inventory.sourceContracts??{},node))visit(inventory.sourceContracts[node]);return;}if(!node||typeof node!=='object')return;if(typeof node.file==='string'&&Number.isInteger(node.line))found.set(`${node.file}:${node.line}`,{file:node.file,line:node.line});for(const child of Object.values(node))if(Array.isArray(child))child.forEach(visit);else visit(child);};
  visit(value);return[...found.values()];
}
function sourceMap(row){
  const source=resolve(root,row.routeSource?.file??'');
  if(!source.startsWith(join(root,'src/app/api')+'/')||!source.endsWith('/route.ts'))throw new Error('Unowned route source refused');
  let actualSourceSha256=null;try{actualSourceSha256=createHash('sha256').update(readFileSync(source)).digest('hex');}catch{/* A missing source is recorded as inventory drift, never synthesized. */}
  return{inventory:relative(root,inventoryFile),inventoryRow:{method:row.method,path:row.path},routeSource:row.routeSource,implementation:row.implementation,aliasOf:row.aliasOf,declaredSourceSha256:row.sourceSha256,actualSourceSha256,sourceDigestMatches:actualSourceSha256===row.sourceSha256,callerReferences:references(row.productionConsumers),requestContractReferences:references(row.requestValidation),responseContractReferences:references(row.responseValidation),serviceSqlReferences:references(row.serviceAndRepository),authorizationReferences:references(row.authorizationScopeOwnerAndPin),sourceContractRefs:row.authorizationScopeOwnerAndPin?.sourceContractRefs??[]};
}
function classify(status,json,isJson,contentType){
  const code=typeof json?.error?.code==='string'?json.error.code:'';
  if(/disabled|not_enabled|unavailable|not_configured/i.test(code)&&status<500||/disabled|not_enabled|not_configured/i.test(code))return'feature-disabled-rejection';
  if(status>=500)return'server-error-requires-adjudication';
  if(status===401||status===403)return isJson?'json-auth-or-policy-rejection':'nonjson-auth-or-policy-rejection';
  if(status===400||status===422)return isJson?'json-validation-or-client-rejection':'nonjson-client-rejection';
  if(status===404)return isJson?'json-data-or-feature-not-found':/html/i.test(contentType)?'html-404-registration-requires-adjudication':'nonjson-not-found-requires-adjudication';
  if(status===405)return'method-rejection';
  if(status===429)return'rate-limit-rejection';
  if(status>=300&&status<400)return'redirect-not-followed';
  if(status>=200&&status<300)return isJson?'json-success-unvalidated':'protocol-or-nonjson-success-unvalidated';
  return'unclassified-response';
}
async function probe(method,path){
  const url=new URL(path,manifest.appOrigin);if(url.origin!==manifest.appOrigin)throw new Error('Non-loopback endpoint refused');
  return new Promise(resolveProbe=>{
    const started=Date.now();
    const mutation=!['GET','HEAD','OPTIONS'].includes(method);
    const req=request(url,{method,family:4,ca:readFileSync(manifest.ca),signal:AbortSignal.timeout(90000),headers:{origin:manifest.appOrigin,accept:'application/json',...(mutation?{'content-type':'application/json','content-length':'2'}:{})}},response=>{
      let size=0,truncated=false;const chunks=[],hash=createHash('sha256');
      response.on('data',chunk=>{size+=chunk.length;hash.update(chunk);if(size<=256*1024)chunks.push(chunk);else truncated=true;});
      response.on('end',()=>{
        let json;try{if(!truncated)json=JSON.parse(Buffer.concat(chunks).toString());}catch{/* HTML/protocol responses remain distinct. */}
        const contentType=String(response.headers['content-type']??'');
        const code=typeof json?.error?.code==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(json.error.code)?json.error.code:null;
        resolveProbe({status:response.statusCode,code,contentType,bodyBytes:size,bodySha256:hash.digest('hex'),classification:classify(response.statusCode,json,json!==undefined,contentType),elapsedMs:Date.now()-started,positiveBehaviorVerified:false});
      });
      response.on('error',()=>resolveProbe({status:response.statusCode,classification:'response-transport-error',elapsedMs:Date.now()-started,positiveBehaviorVerified:false}));
    });
    req.on('error',error=>resolveProbe({status:null,code:typeof error.code==='string'?error.code:null,classification:'request-transport-error',elapsedMs:Date.now()-started,positiveBehaviorVerified:false}));
    if(mutation)req.write('{}');req.end();
  });
}
const results=[],log=join(manifest.runtime,'backend-rejection-probes.jsonl');writeFileSync(log,'',{mode:0o600});
for(const row of inventory.routes){
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(row.method))throw new Error('Unsupported inventory method');
  const key=`${row.method} ${row.path}`;if(unique.has(key))throw new Error('Duplicate inventory method/path');unique.add(key);
  const path=concrete(row.path);
  const result={method:row.method,pattern:row.path,path,requestMode:'unauthenticated; invalid{} mutation bodies only',sourceMap:sourceMap(row),...await probe(row.method,path)};
  results.push(result);appendFileSync(log,JSON.stringify(result)+'\n',{mode:0o600});
  console.log(JSON.stringify({index:results.length,total:inventory.routes.length,method:row.method,path,status:result.status,code:result.code,classification:result.classification}));
}
const classificationCounts=Object.fromEntries([...new Set(results.map(row=>row.classification))].map(kind=>[kind,results.filter(row=>row.classification===kind).length]));
const receipt={kind:'actual-next-unauthenticated-rejection-census',inventorySha256:createHash('sha256').update(bytes).digest('hex'),inventoryDeclaredSourceHead:inventory.sourceHead,plannedMethodPairs:inventory.routes.length,attemptedMethodPairs:results.length,classificationCounts,positiveBehaviorVerified:false,boundaries:['Negative/registration observations do not verify successful business behavior or an authorization matrix','Local unauthenticated invalid requests can still have side effects; run only against this disposable fixture','HTML404 can be an explicit handler notFound; source-linked registration gaps require adjudication','Original source audit dispositions are not modified or upgraded'],results};
writeFileSync(join(manifest.runtime,'backend-rejection-probes.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
if(results.some(row=>/requires-adjudication|transport-error/.test(row.classification)))process.exitCode=1;
