#!/usr/bin/env node
import { createAzureTargetClient } from './target.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeDatabaseFailure } from './diagnostics.mjs';

export function authenticatorExpiry(value) {
  if(value==='infinity')return value;
  const expiry=new Date(value);
  if(typeof value!=='string'||!Number.isFinite(expiry.getTime())||expiry.getTime()<=Date.now())throw new Error('An explicit future credential expiry or infinity is required');
  return expiry.toISOString();
}
export async function configureAuthenticator(db,password,expiresAt) {
  if(typeof password!=='string'||password.length<32||password.length>256)throw new Error('A strong authenticator credential is required');
  const expiry=authenticatorExpiry(expiresAt);
  await db.query('begin');
  try {
    const privileges=(await db.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname='academy_authenticator'")).rows[0];
    const memberships=(await db.query("select parent.rolname from pg_auth_members m join pg_roles child on child.oid=m.member join pg_roles parent on parent.oid=m.roleid where child.rolname='academy_authenticator' order by parent.rolname")).rows.map(row=>row.rolname);
    if(!privileges||Object.values(privileges).some(Boolean)||JSON.stringify(memberships)!==JSON.stringify(['authenticated','service_role']))throw new Error('Authenticator privileges differ from the approved bootstrap');
    // Bind secrets as parameters; the CLI never logs SQL values or driver errors.
    await db.query("select set_config('academy.provisioning.password',$1,true),set_config('academy.provisioning.expiry',$2,true)",[password,expiry]);
    await db.query(`do $$begin execute format('alter role academy_authenticator login noinherit password %L valid until %L',current_setting('academy.provisioning.password'),current_setting('academy.provisioning.expiry')); end $$`);
    await db.query('commit');
    return {role:'academy_authenticator',expiresAt:expiry};
  }catch(error){await db.query('rollback');throw error;}
}
async function main(){
  let db;
  try{
    db=createAzureTargetClient();
    await db.connect();
    const receipt=await configureAuthenticator(db,process.env.AZURE_AUTHENTICATOR_PASSWORD,process.env.AZURE_AUTHENTICATOR_EXPIRES_AT);
    console.log(JSON.stringify(receipt));
  }catch(error){console.error(JSON.stringify(safeDatabaseFailure(error,'AUTHENTICATOR_FAILED','configure-authenticator')));process.exitCode=1;}
  finally{await db?.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(error=>{console.error(JSON.stringify(safeDatabaseFailure(error,'AUTHENTICATOR_FAILED','configure-authenticator')));process.exitCode=1;});
