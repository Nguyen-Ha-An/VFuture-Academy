import { readdirSync } from 'node:fs';
import { expect,it } from 'vitest';
import { ownedMigrationNames,azureSchemaStepNames,buildAzureSchema } from '../../scripts/azure-core/schema.mjs';
import { REPAIR_MIGRATIONS } from '../../infra/azure-core/archive-policy.mjs';
it.each(['._0001_identity.sql','_0001_identity.sql','.0001_identity.sql','.hidden.sql','manual.sql','00001_identity.sql','2026090606594_identity.sql','0001_identity.SQL','__MACOSX','.DS_Store','._notes.md'])('rejects metadata or unknown SQL rather than silently selecting around it: %s',name=>{
  expect(()=>ownedMigrationNames(['0001_identity.sql',name])).toThrow('Unexpected migration directory entry');
});
it('appends the private assignment journal after the fixed teacher release and repairs',()=>{
  const names=readdirSync(new URL('../../supabase/migrations/',import.meta.url));
  const eligible=ownedMigrationNames(names);
  expect(eligible).toHaveLength(67);
  expect(eligible.slice(54,59)).toEqual(['20261106010000_course_teaching_assignments.sql','20261106011000_exam_teaching_scope.sql','20261106020000_teaching_grading_guards.sql','20261106030000_teaching_report_scope.sql','20261106040000_management_teaching_scope.sql']);
  expect(eligible.slice(59)).toEqual([...REPAIR_MIGRATIONS, '20261128000001_academy_private_assignment_files.sql']);
  expect(ownedMigrationNames([...eligible].reverse())).toEqual(eligible);
  const artifact=buildAzureSchema();
  expect(artifact.receipt.migrations.map(migration=>migration.file)).toEqual(eligible);
  expect(azureSchemaStepNames()).toEqual(artifact.steps.map(step=>step.id));
  expect(artifact.steps).toHaveLength(eligible.length + 8);
});
it.each([
  ['20261105020000_teaching_permissions_activation.sql','11cb8a40fc391217127bad255fefb375654902ff2ea7b93e51eb87bae562f679'],
  ['20261105030000_exam_attachment_bindings.sql','367e15e9fb06cb0d8fa14145a30214d3d0dfbe0cd25f14e914486a8040349875'],
  ['20261106000000_managed_profile_handles.sql','425a983f26c7413556351975436e445c1dace551f52aa31ba1dea7a19cdbdc5a'],
  ['20261106040000_management_teaching_scope.sql','6252d759db0d6f14fc5178954aacd861b553fbc609dcd7c4508e7ad2ea4ab342'],
])('retains every historical SQL byte through %s', (through, digest)=>{
  expect(buildAzureSchema({through}).receipt.schemaSha256).toBe(digest);
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
