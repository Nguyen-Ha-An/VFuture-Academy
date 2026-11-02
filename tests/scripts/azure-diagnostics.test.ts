import { expect,it } from 'vitest';
import { safeDatabaseFailure } from '../../scripts/azure-core/diagnostics.mjs';
it('reports only fixed stage/error enums and an allowlisted database or runtime code',()=>{
  const secret={message:'password=secret',detail:'private record',query:'SQL secret',code:'42501'};
  expect(safeDatabaseFailure(secret,'MIGRATION_FAILED','schema')).toEqual({errorCode:'MIGRATION_FAILED',stage:'schema',sqlState:'42501',runtimeCode:null,schemaStep:null,position:null});
  expect(safeDatabaseFailure({...secret,code:'ENOTFOUND'},'AUTHENTICATOR_FAILED','configure-authenticator')).toEqual({errorCode:'AUTHENTICATOR_FAILED',stage:'configure-authenticator',sqlState:null,runtimeCode:'ENOTFOUND',schemaStep:null,position:null});
  const rejected=safeDatabaseFailure({...secret,code:'password=secret'},'untrusted-secret','secret-stage');
  expect(rejected).toEqual({errorCode:'MIGRATION_FAILED',stage:'unknown',sqlState:null,runtimeCode:null,schemaStep:null,position:null});
  expect(JSON.stringify(rejected)).not.toContain('secret');
});

it('reports exact owned schema steps and positive numeric positions only for schema failures',()=>{
  const safe=safeDatabaseFailure({code:'08P01',schemaStep:'bootstrap.sql',position:'123',message:'private'},'MIGRATION_FAILED','schema');
  expect(safe).toMatchObject({schemaStep:'bootstrap.sql',position:123});
  expect(safeDatabaseFailure({schemaStep:'private/password.sql',position:'-1'},'MIGRATION_FAILED','schema')).toMatchObject({schemaStep:null,position:null});
  expect(safeDatabaseFailure({schemaStep:'bootstrap.sql',position:'123'},'MIGRATION_FAILED','import')).toMatchObject({schemaStep:null,position:null});
});
