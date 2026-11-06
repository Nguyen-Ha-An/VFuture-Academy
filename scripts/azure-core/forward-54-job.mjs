// Fixed private-job entrypoint. Archive hashes replace unavailable .git only here;
// the local CLI continues to require its actual clean committed checkout.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyForward54Artifact,canonical54 } from './forward-54-artifact.mjs';
export async function runForward54Job(mode,env=process.env){
 if(!['verify','plan','apply'].includes(mode))throw new Error('Invalid fixed54 job mode');
 const first=verifyForward54Artifact();
 await import('pg'); // Resolve the verified locked closure, never download dependencies.
 const verify=()=>{const current=verifyForward54Artifact();if(current.contentSha256!==first.contentSha256||current.manifestSha256!==first.manifestSha256)throw new Error('54 archive changed during execution');return current;};
 if(mode==='verify')return {action:'forward-54-package',source:first.source,packageContentSha256:first.contentSha256};
 if(mode==='apply'&&!first.reviewedPlanSha256)throw new Error('Reviewed54 plan missing');
 const {runForward54Cli}=await import('./forward-54-cli.mjs');
 const proof={captureSource:()=>verify().source,assertSource:expected=>{const source=verify().source;if(canonical54(source)!==canonical54(expected))throw new Error('54 committed source mismatch');return source;},verifyReviewed:envelope=>{const current=verify();if(envelope.packageContentSha256!==current.contentSha256||canonical54(envelope.source)!==canonical54(current.source))throw new Error('Reviewed54 archive mismatch');}};
 const result=await runForward54Cli(mode,env,proof);
 verify();
 return {...result,source:first.source,packageContentSha256:first.contentSha256};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)throw new Error('Invalid fixed54 job mode');console.log(JSON.stringify(await runForward54Job(process.argv[2])));}
 catch(error){const code=typeof error?.code==='string'?error.code:'';const runtime=new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN']);console.error(JSON.stringify({errorCode:'FORWARD_54_FAILED',sqlState:/^[0-9A-Z]{5}$/.test(code)?code:null,runtimeCode:runtime.has(code)?code:null}));process.exitCode=1;}
}
