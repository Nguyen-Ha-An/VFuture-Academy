import { readdirSync } from 'node:fs';
import { expect,it } from 'vitest';
import { ownedMigrationNames,azureSchemaStepNames,buildAzureSchema } from '../../scripts/azure-core/schema.mjs';
it.each(['._0001_identity.sql','_0001_identity.sql','.0001_identity.sql','.hidden.sql','manual.sql','00001_identity.sql','2026090606594_identity.sql','0001_identity.SQL','__MACOSX','.DS_Store','._notes.md'])('rejects metadata or unknown SQL rather than silently selecting around it: %s',name=>{
  expect(()=>ownedMigrationNames(['0001_identity.sql',name])).toThrow('Unexpected migration directory entry');
});
it('accepts only the current numeric owned migration names in deterministic order',()=>{
  const names=readdirSync(new URL('../../supabase/migrations/',import.meta.url));
  const eligible=ownedMigrationNames(names);
  expect(eligible).toHaveLength(53);
  expect(ownedMigrationNames([...eligible].reverse())).toEqual(eligible);
  const artifact=buildAzureSchema();
  expect(artifact.receipt.migrations.map(migration=>migration.file)).toEqual(eligible);
  expect(azureSchemaStepNames()).toEqual(artifact.steps.map(step=>step.id));
  expect(artifact.steps).toHaveLength(eligible.length + 6);
});
it('projects the immutable V1 release boundary without packaging later migrations',()=>{
  const artifact=buildAzureSchema({through:'20261105020000_teaching_permissions_activation.sql'});
  expect(artifact.receipt.migrations).toHaveLength(52);
  expect(artifact.receipt.migrations.at(-1)?.file).toBe('20261105020000_teaching_permissions_activation.sql');
  expect(artifact.steps.some(step=>step.id.includes('exam_attachment_bindings'))).toBe(false);
  expect(()=>buildAzureSchema({through:'missing.sql'})).toThrow('Unknown migration boundary');
});
it('never treats unrelated non-SQL documentation as executable',()=>{
  expect(ownedMigrationNames(['README.md','0001_identity.sql'])).toEqual(['0001_identity.sql']);
});
