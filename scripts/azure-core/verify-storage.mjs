#!/usr/bin/env node
// Read-only API verification; never changes retained buckets, policies or objects.
import { createClient } from '@supabase/supabase-js';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inventoryStorage,tableDigest } from './snapshot.mjs';
try{
  const url=process.env.SOURCE_SUPABASE_URL;
  const key=process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key||new URL(url).protocol!=='https:')throw new Error('Read-only Storage credentials are required');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const path=resolve('build/azure-core/private/source-snapshot.json');
  const snapshot=JSON.parse(readFileSync(path,'utf8'));
  const actual=await inventoryStorage(db.storage);
  if(tableDigest(actual)!==tableDigest(snapshot.storage))throw new Error('Actual Storage inventory differs from the exported snapshot; recapture under write freeze');
  const caps={};
  for(const [bucket,maximum] of [['media',52428800],['submissions',52428800],['notebooks',10485760]]){
    const result=await db.storage.getBucket(bucket);
    const limit=result.data?.file_size_limit;
    caps[bucket]={requiredMaximum:maximum,configuredMaximum:limit??null,valid:!result.error&&Number.isSafeInteger(limit)&&limit>0&&limit<=maximum};
  }
  const verification={source:'supabase-storage-api',sha256:tableDigest(actual),checkedAt:new Date().toISOString(),privateBuckets:true,signingLimits:caps};
  snapshot.storageVerification=verification;
  writeFileSync(path,JSON.stringify(snapshot),{mode:0o600});
  writeFileSync(resolve('build/azure-core/storage-api-receipt.json'),JSON.stringify(verification,null,2)+'\n',{mode:0o600});
  console.log('Actual private Storage inventory matches snapshot. Signing-limit results are in the nonsecret receipt; invalid limits block signed uploads.');
}catch(error){console.error(error instanceof Error?error.message:'Storage verification failed');process.exitCode=1;}
