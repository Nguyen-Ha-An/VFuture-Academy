import { afterEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),write:vi.fn(),mkdir:vi.fn(),apply:vi.fn()}));
vi.mock('../../scripts/azure-core/target.mjs',()=>({createAzureTargetClient:mocks.create}));
vi.mock('node:fs',()=>({readFileSync:vi.fn(),writeFileSync:mocks.write,mkdirSync:mocks.mkdir}));
vi.mock('../../scripts/azure-core/schema.mjs',()=>({buildAzureSchema:()=>({sql:'owned ddl',steps:[{id:'bootstrap.sql',sql:'owned ddl'}],receipt:{schemaSha256:'nonsecret'}}),applyAzureSchema:mocks.apply,azureSchemaStepNames:()=>['bootstrap.sql']}));
vi.mock('../../scripts/azure-core/restore.mjs',()=>({restoreSnapshot:vi.fn()}));
import { migrateMain } from '../../scripts/azure-core/migrate.mjs';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it('dry run remains credential-free and never constructs a client or applies schema',async()=>{
  vi.stubEnv('AZURE_DATABASE_URL',undefined);vi.stubEnv('AZURE_TARGET_HOST',undefined);
  vi.spyOn(console,'log').mockImplementation(()=>{});
  await migrateMain(['schema']);
  expect(mocks.create).not.toHaveBeenCalled();expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(mocks.write.mock.calls[0][1]).toBe('owned ddl');
});
