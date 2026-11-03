import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { mkdirSync,writeFileSync } from 'node:fs';
const started=performance.now();
const {acceptOtp,boundedCallback,CALLBACK_BUDGET_MS}=await import('./functions/src/email-pipeline.mjs');
const {verifyExtensionToken}=await import('./functions/src/auth.mjs');
const {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT}=await import(createRequire(new URL('./functions/package.json',import.meta.url)).resolve('jose'));
const moduleImportMs=performance.now()-started;
const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='benchmark';
const keys=createLocalJWKSet({keys:[jwk]});
const config={tenantId:'test',issuer:'https://test.ciamlogin.com/test/v2.0',audience:'benchmark-api'};
const now=Math.floor(Date.now()/1000);
const token=await new SignJWT({iss:config.issuer,aud:config.audience,tid:config.tenantId,azp:'99045fe1-7639-4a75-9d4a-577b6ca3810f',ver:'2.0',iat:now,nbf:now,exp:now+300}).setProtectedHeader({alg:'RS256',kid:'benchmark'}).sign(pair.privateKey);
const durations=[];
for(let i=0;i<100;i++){
  const start=performance.now();
  await boundedCallback(async signal=>{
    await verifyExtensionToken(token,config,keys);
    await acceptOtp({email:'benchmark@example.invalid',code:'12345678',correlationId:'11111111-2222-3333-4444-555555555555'},{secret:'local-benchmark-secret-'.repeat(3),signal,enqueue:()=>new Promise(resolve=>setTimeout(resolve,20))});
  });durations.push(performance.now()-start);
}
durations.sort((a,b)=>a-b);
const result={kind:'local-mocked-io-only',node:process.version,iterations:100,injectedQueueLatencyMs:20,jwks:'local RSA key; no network',managedIdentity:'not modeled',azureHostColdStart:'not modeled',applicationDeadlineMs:CALLBACK_BUDGET_MS,moduleImportMs,p50Ms:durations[49],p95Ms:durations[94],maxMs:durations.at(-1),hostedDeadlineVerified:false};
mkdirSync('build/azure-core',{recursive:true});writeFileSync('build/azure-core/email-local-benchmark.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
