import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { REPAIR_MIGRATIONS, validateAssessmentReceipt } from '../archive-policy.mjs';
import { canonical, sha256 } from '../../../scripts/azure-core/forward-artifact.mjs';
import { FORWARD55_BOUNDARY } from '../../../scripts/azure-core/forward-55-artifact.mjs';
import { catalogContract, forward56Evidence, FORWARD56_EVIDENCE, FORWARD56_PLAN, forward56SourceFiles, repairArtifact } from '../../../scripts/azure-core/forward-56-artifact.mjs';
import { buildAzureSchema } from '../../../scripts/azure-core/schema.mjs';

const checkout = fileURLToPath(new URL('../../../', import.meta.url));
function priorNoop() {
  const source = { sourceClean: true, sourceCommit: '1'.repeat(40), sourceTree: '2'.repeat(40) };
  const handles = buildAzureSchema({through:'20261106000000_managed_profile_handles.sql'});
  const handle = handles.receipt.migrations.at(-1);
  const release = buildAzureSchema({through:FORWARD55_BOUNDARY});
  const migrations = release.receipt.migrations.slice(54);
  const identity = artifact => sha256(artifact.steps.find(step => step.id === 'src/lib/identity/schema.sql').sql);
  return {
    action:'forward-55-plan', source, packageContentSha256:'1'.repeat(64), encryptedPackageSha256:'2'.repeat(64), sourceManifestSha256:'3'.repeat(64),
    plan:{
      action:'noop', filename:migrations[0].file, sourceSha256:migrations[0].sourceSha256, azureSha256:migrations[0].azureSha256, identitySha256:identity(release), migrations,
      baseline:'273796447b61aead3444fc90e9150c2cfb56c8cf2bb8300d06fede1a70661149', activationSha:'3'.repeat(40),
      predecessor:{filename:handle.file,source_sha256:handle.sourceSha256,azure_sha256:handle.azureSha256,identity_sha256:identity(handles),source_commit:'4'.repeat(40),source_tree:'5'.repeat(40)},
      priorReceiptDigest:'4'.repeat(64), roleCount:3, roleDigest:'5'.repeat(64),
      teacherCutoverInventory:{ordinaryActorCount:0,eligibleBranchTeacherPairCount:0,activeEnrollmentCourseBranchPairCount:0,ordinaryGlobalActorWithoutMembershipCount:0,requiresInitialAssignments:false},
      source, receiptSourceCommit:source.sourceCommit, receiptSourceTree:source.sourceTree,
    },
  };
}

test('requires an exact immutable post55 noop and the released SQL hashes', () => {
  const valid = priorNoop();
  assert.equal(forward56Evidence(valid), valid);
  for (const mutation of [
    prior => { delete prior.encryptedPackageSha256; },
    prior => { prior.action = 'forward-55-apply'; },
    prior => { prior.plan.action = 'apply'; },
    prior => { prior.plan.identitySha256 = '0'.repeat(64); },
    prior => { prior.plan.migrations[1].azureSha256 = '0'.repeat(64); },
    prior => { prior.plan.additionalRows = []; },
  ]) {
    const changed = structuredClone(valid);
    mutation(changed);
    assert.throws(() => forward56Evidence(changed));
  }
});

test('encrypts and verifies a relocated repair package and binds the reviewed plan for apply', () => {
  const root = mkdtempSync(join(tmpdir(), 'academy-repair-transport-'));
  const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], {
    cwd:root, encoding:'utf8', env:{...process.env, COPYFILE_DISABLE:'1', LC_ALL:'C'},
  });
  const writeJson = (file, value) => writeFileSync(join(root,file), JSON.stringify(value) + '\n', {mode:0o600});
  const pack = () => run('infra/azure-core/migration/package.mjs','--forward-56');
  const packageReceipt = () => JSON.parse(readFileSync(join(root,'build/azure-core/migration-package-receipt.json')));
  try {
    const required = [...forward56SourceFiles(), 'scripts/azure-core', 'infra/azure-core/migration/package.mjs','infra/azure-core/migration/verify-package.mjs'];
    for (const file of required) {
      mkdirSync(dirname(join(root,file)), {recursive:true});
      cpSync(join(checkout,file),join(root,file), {recursive:true});
    }
    writeFileSync(join(root,'.gitignore'),'node_modules\nbuild/\n');
    symlinkSync(join(checkout,'node_modules'), join(root,'node_modules'),'dir');
    for (const args of [['init','-q'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgSign=false','-c','core.hooksPath=/dev/null','commit','-qm','Repair package fixture']]) {
      execFileSync('git',args,{cwd:root,stdio:'pipe'});
    }
    mkdirSync(join(root,'build/azure-core/private'),{recursive:true});
    const prior = priorNoop();
    writeJson(FORWARD56_EVIDENCE,prior);
    const first = pack();
    assert.equal(first.status,0,first.stderr);
    const planPackage = packageReceipt();
    assert.equal(planPackage.packageType,'forward-56');
    assert.equal(planPackage.reviewedPlanSha256,null);
    const relocate = () => run('infra/azure-core/migration/verify-package.mjs');
    const verified = relocate();
    assert.equal(verified.status,0,verified.stderr);
    const source={sourceClean:true,sourceCommit:planPackage.sourceCommit,sourceTree:planPackage.sourceTree};
    const reviewed={
      action:'forward-56-plan',source,packageContentSha256:planPackage.packageContentSha256,
      encryptedPackageSha256:planPackage.sha256,sourceManifestSha256:planPackage.sourceManifestSha256,
      plan:{action:'apply',filename:REPAIR_MIGRATIONS[0],steps:repairArtifact().hashes,source,
        evidenceSha256:sha256(canonical(prior)),priorReceiptDigest:'6'.repeat(64),catalogSha256:catalogContract().before},
    };
    assert.equal(validateAssessmentReceipt(reviewed,reviewed.action,{transport:true}),reviewed);
    writeJson(FORWARD56_PLAN,reviewed);
    const second=pack();
    assert.equal(second.status,0,second.stderr);
    const applyPackage=packageReceipt();
    assert.equal(applyPackage.packageContentSha256,planPackage.packageContentSha256);
    assert.notEqual(applyPackage.sha256,planPackage.sha256);
    assert.equal(applyPackage.reviewedPlanSha256,sha256(readFileSync(join(root,FORWARD56_PLAN))));
    const verifiedApply=relocate();
    assert.equal(verifiedApply.status,0,verifiedApply.stderr);
    for (const mutation of [
      value => { value.plan.steps.reverse(); },
      value => { value.plan.steps.at(-1).sourceSha256 = '0'.repeat(64); },
      value => { value.packageContentSha256 = '0'.repeat(64); },
      value => { value.plan.rows = []; },
    ]) {
      const changed=structuredClone(reviewed);
      mutation(changed);
      writeJson(FORWARD56_PLAN,changed);
      assert.notEqual(pack().status,0);
    }
    writeJson(FORWARD56_PLAN,reviewed);
    writeJson(FORWARD56_EVIDENCE,{...prior,sourceManifestSha256:'8'.repeat(64)});
    assert.notEqual(pack().status,0);
    const wrongMode=run('infra/azure-core/migration/package.mjs','--forward-56-apply');
    assert.notEqual(wrongMode.status,0);
    assert.match(wrongMode.stderr,/Unknown forward package/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
