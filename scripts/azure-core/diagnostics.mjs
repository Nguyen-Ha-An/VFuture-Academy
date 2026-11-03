import { azureSchemaStepNames } from './schema.mjs';
const runtimeCodes=new Set(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN']);
const stages=new Set(['schema','import','configure-authenticator']);
/** Never serialize the driver error itself: it can contain SQL, rows and secrets. */
export function safeDatabaseFailure(error,errorCode,stage){
  const code=error&&typeof error==='object'&&typeof error.code==='string'?error.code:null;
  let schemaStep=null;
  let position=null;
  if(stage==='schema'&&error&&typeof error==='object'){
    try{if(typeof error.schemaStep==='string'&&azureSchemaStepNames().includes(error.schemaStep))schemaStep=error.schemaStep;}catch{/* Missing source files cannot make error reporting unsafe. */}
    const raw=error.position;
    const parsed=typeof raw==='number'?raw:typeof raw==='string'&&/^[1-9][0-9]*$/.test(raw)?Number(raw):NaN;
    if(Number.isSafeInteger(parsed)&&parsed>0)position=parsed;
  }
  return {
    errorCode:errorCode==='AUTHENTICATOR_FAILED'?'AUTHENTICATOR_FAILED':'MIGRATION_FAILED',
    stage:stages.has(stage)?stage:'unknown',
    sqlState:code&&/^[0-9A-Z]{5}$/.test(code)?code:null,
    runtimeCode:runtimeCodes.has(code)?code:null,
    schemaStep,position,
  };
}
