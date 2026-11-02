import { expect,it,vi } from 'vitest';
import { configureAuthenticator } from '../../scripts/azure-core/configure-authenticator.mjs';
it('binds credentials, requires explicit expiry, and refuses excessive role membership',async()=>{
  const query=vi.fn(async(sql:string)=>sql.includes('select rolsuper')?{rows:[{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false}]}:sql.includes('select parent.rolname')?{rows:[{rolname:'authenticated'},{rolname:'service_role'}]}:{rows:[]});
  const secret='x'.repeat(40);
  await configureAuthenticator({query},secret,'2099-01-01T00:00:00Z');
  expect(query.mock.calls.every(call=>!call[0].includes(secret))).toBe(true);
  expect(query).toHaveBeenCalledWith("select set_config('academy.provisioning.password',$1,true),set_config('academy.provisioning.expiry',$2,true)",[secret,'2099-01-01T00:00:00.000Z']);
  await expect(configureAuthenticator({query},secret,'2000-01-01')).rejects.toThrow('expiry');
  const excessive={query:vi.fn(async(sql:string)=>sql.includes('select rolsuper')?{rows:[{rolsuper:true}]}:sql.includes('select parent.rolname')?{rows:[]}:{rows:[]})};
  await expect(configureAuthenticator(excessive,secret,'2099-01-01')).rejects.toThrow('privileges');
  expect(excessive.query).toHaveBeenLastCalledWith('rollback');
});
it('allows an explicitly non-expiring native credential without accepting missing or malformed expiry',async()=>{
  const query=vi.fn(async(sql:string)=>sql.includes('select rolsuper')?{rows:[{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false}]}:sql.includes('select parent.rolname')?{rows:[{rolname:'authenticated'},{rolname:'service_role'}]}:{rows:[]});
  expect(await configureAuthenticator({query},'x'.repeat(40),'infinity')).toEqual({role:'academy_authenticator',expiresAt:'infinity'});
  await expect(configureAuthenticator({query},'x'.repeat(40),undefined)).rejects.toThrow('expiry');
  await expect(configureAuthenticator({query},'x'.repeat(40),'never')).rejects.toThrow('expiry');
});
