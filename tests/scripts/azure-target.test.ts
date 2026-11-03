import { beforeEach,expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({construct:vi.fn(),connect:vi.fn()}));
vi.mock('pg',()=>({Client:class{constructor(options:unknown){mock.construct(options);}connect=mock.connect;}}));
import { createAzureTargetClient } from '../../scripts/azure-core/target.mjs';
const target='approved.postgres.database.azure.com';
const valid={AZURE_TARGET_HOST:target,AZURE_DATABASE_URL:`postgresql://academy_admin:private-test-password@${target}:5432/academy?sslmode=verify-full`};
beforeEach(()=>vi.clearAllMocks());
it.each([
  {...valid,AZURE_TARGET_HOST:undefined},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL.replace(target,'other.postgres.database.azure.com')},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL.replace('/academy','/other')},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL.replace(':5432',':5433')},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL+'&host=other.postgres.database.azure.com'},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL+'&dbname=other'},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL.replace('academy_admin:','other_admin:')},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL.replace('verify-full','disable')},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL+'&sslrootcert=/untrusted.pem'},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL+'&sslmode=verify-full'},
  {...valid,AZURE_DATABASE_URL:valid.AZURE_DATABASE_URL+'#'},
  {...valid,AZURE_DATABASE_URL:'invalid-private-test-password'},
])('rejects an unapproved target before constructing or connecting a client',source=>{
  expect(()=>createAzureTargetClient(source)).toThrow('Invalid Azure migration target');
  expect(mock.construct).not.toHaveBeenCalled();expect(mock.connect).not.toHaveBeenCalled();
});
it('normalizes the approved target and enforces certificate validation without connecting',()=>{
  createAzureTargetClient(valid,{statement_timeout:120000});
  expect(mock.construct).toHaveBeenCalledWith({connectionString:`postgresql://academy_admin:private-test-password@${target}:5432/academy`,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:120000});
  expect(mock.connect).not.toHaveBeenCalled();
});

it('accepts the approved default-port URI without query parameters',()=>{
  createAzureTargetClient({...valid,AZURE_DATABASE_URL:`postgresql://academy_admin:private-test-password@${target}/academy`});
  expect(mock.construct).toHaveBeenCalledOnce();expect(mock.connect).not.toHaveBeenCalled();
});
