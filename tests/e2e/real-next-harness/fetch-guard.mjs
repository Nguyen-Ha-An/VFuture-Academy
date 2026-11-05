import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reject network egress; never substitutes a fixture response for an application fetch. */
export function installLocalFetchGuard(runtime){
  if(!runtime)throw new Error('An owned fixture runtime directory is required');
  const original=globalThis.fetch;
  const allowed=new Set(['https://localhost:4451','https://localhost:4452','http://127.0.0.1:4454']);
  const record=value=>appendFileSync(join(runtime,'outbound-fetch.jsonl'),JSON.stringify({at:new Date().toISOString(),...value})+'\n',{mode:0o600});
  globalThis.fetch=async function localFixtureFetch(input,init){
    let url;
    try{url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);}catch{
      record({outcome:'blocked',reason:'invalid-absolute-url'});throw new Error('Fixture fetch refused an invalid absolute URL');
    }
    const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const metadata={method,origin:url.origin,pathname:url.pathname};
    if(url.username||url.password||url.hash||!allowed.has(url.origin)){
      record({...metadata,outcome:'blocked',reason:'non-approved-origin'});
      throw new Error('Fixture fetch refused non-loopback network egress');
    }
    // Native automatic redirect following would bypass a wrapper on global fetch.
    // Manual redirects stay manual; all other redirects fail closed in native fetch.
    const requested=init?.redirect??(input instanceof Request?input.redirect:'follow');
    const measured=url.pathname==='/rpc/exam_finalize_attempt' || url.pathname==='/rpc/exam_save_active_answers';
    const body=init?.body;
    const requestBodyBytes=typeof body==='string'?Buffer.byteLength(body):body instanceof Uint8Array?body.byteLength:null;
    const started=measured?performance.now():0;
    try{
      const response=await original(input,{...init,redirect:requested==='manual'?'manual':'error'});
      if(measured) record({outcome:'measured-exam-rpc',rpc:url.pathname.slice(5),requestBodyBytes,status:response.status,
        elapsedToHeadersMs:Math.round((performance.now()-started)*100)/100,timing:'instrumented-to-headers'});
      return response;
    }
    catch(error){record({...metadata,outcome:'allowed-fetch-failed',code:typeof error?.cause?.code==='string'?error.cause.code:null});throw error;}
  };
}
