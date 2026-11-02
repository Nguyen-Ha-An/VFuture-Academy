import { createHash } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { applyAzureSchema,buildAzureSchema } from '../../scripts/azure-core/schema.mjs';
it('preserves the exact combined SQL and digest with ordered owned-file steps',()=>{
  const artifact=buildAzureSchema();
  expect(artifact.steps[0].id).toBe('bootstrap.sql');
  expect(artifact.steps.slice(1,1+artifact.receipt.migrations.length).map(step=>step.id)).toEqual(artifact.receipt.migrations.map(migration=>`supabase/migrations/${migration.file}`));
  expect(artifact.steps.slice(-5).map(step=>step.id)).toEqual(['storage.sql','src/lib/identity/schema.sql','src/lib/identity/admin-schema.sql','media-delete.sql','account-access.sql']);
  expect(artifact.steps.map(step=>step.sql).join('\n\n')).toBe(artifact.sql);
  expect(createHash('sha256').update(artifact.sql).digest('hex')).toBe(artifact.receipt.schemaSha256);
});
it('rolls back a failed middle step and preserves safe position without later DDL or commit',async()=>{
  const query=vi.fn(async(sql:string)=>{if(sql==='bad ddl')throw Object.assign(new Error('private driver detail'),{code:'08P01',position:'42'});return {rows:[]};});
  const steps=[{id:'bootstrap.sql',sql:'first ddl'},{id:'storage.sql',sql:'bad ddl'},{id:'account-access.sql',sql:'last ddl'}];
  await expect(applyAzureSchema({query},{steps})).rejects.toMatchObject({code:'08P01',schemaStep:'storage.sql',position:'42'});
  expect(query.mock.calls.map(call=>call[0])).toEqual(['begin','first ddl','bad ddl','rollback']);
});
it('commits only after every step succeeds in one transaction',async()=>{
  const query=vi.fn(async()=>({rows:[]}));
  await applyAzureSchema({query},{steps:[{id:'bootstrap.sql',sql:'first ddl'},{id:'storage.sql',sql:'last ddl'}]});
  expect(query.mock.calls).toEqual([['begin'],['first ddl'],['last ddl'],['commit']]);
});
