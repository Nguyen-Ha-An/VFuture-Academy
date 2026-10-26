import { describe, expect, it } from 'vitest';
// Runtime deployment preflight is also invoked by the operator plan CLI.
import { validateProvisioning, validateRuntime } from '../../infra/azure/preflight.mjs';
import { readFileSync } from 'node:fs';

const input = {
  subscriptionId: '11111111-1111-4111-8111-111111111111',
  resourceGroup: 'rg-vfuture-academy-sg',
  operatorCidr: '',
  sshPublicKey: `ssh-ed25519 ${Buffer.alloc(32, 1).toString('base64')}`,
  imageVersion: '24.04.202610010',
  grantRemainingUsd: 2000,
  committedOtherProjectsUsd: 400,
  months: 12,
  benefitsConfirmed: false,
  budgetStartDate: '2026-11-01',
  notificationEmail: 'operator@example.com',
  acsResourceId: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-vfuture-academy-sg/providers/Microsoft.Communication/communicationServices/academy-sg-acs',
  acsEmailDomainResourceId: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-vfuture-academy-sg/providers/Microsoft.Communication/emailServices/academy-sg-email/domains/mail.example.com',
  acsSmtpUsernameResourceId: '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-vfuture-academy-sg/providers/Microsoft.Communication/communicationServices/academy-sg-acs/smtpUsernames/academy-runtime',
};

describe('Azure provisioning admission', () => {
  it('reserves shared grant commitments and the contingency before admitting the fixed VM', () => {
    expect(validateProvisioning(input).annualAllocationUsd).toBe(1080);
    expect(() => validateProvisioning({ ...input, committedOtherProjectsUsd: 800 })).toThrow(/allocation/);
  });
  it('refuses unrelated resource groups, an unfunded period, and invalid financial evidence', () => {
    expect(() => validateProvisioning({ ...input, resourceGroup: 'foundation' })).toThrow(/resource group/);
    expect(() => validateProvisioning({ ...input, months: 13 })).toThrow(/months/);
    expect(() => validateProvisioning({ ...input, grantRemainingUsd: NaN })).toThrow(/grant/);
    expect(() => validateProvisioning({ ...input, benefitsConfirmed: 'yes' })).toThrow(/benefits/);
  });
  it('disables SSH by default and only accepts one explicit public operator IP', () => {
    expect(validateProvisioning(input).parameters.operatorCidr.value).toBe('');
    expect(validateProvisioning({ ...input, operatorCidr: '203.0.113.9/32' }).parameters.operatorCidr.value).toBe('203.0.113.9/32');
    for (const operatorCidr of ['0.0.0.0/0', '10.1.1.2/32', '1.2.3.4/24', 'Internet', '::/0']) {
      expect(() => validateProvisioning({ ...input, operatorCidr })).toThrow(/operator/);
    }
  });
  it('rejects unverified Standard registry benefits and ACS resources outside Academy', () => {
    expect(validateProvisioning(input).parameters.registrySku.value).toBe('Basic');
    expect(() => validateProvisioning({ ...input, registrySku: 'Standard' })).toThrow(/registry/);
    expect(validateProvisioning({ ...input, benefitsConfirmed: true, registrySku: 'Standard', registryBenefitConfirmed: true, registryBenefitMeterId: 'operator-verified-meter' }).parameters.registrySku.value).toBe('Standard');
    expect(() => validateProvisioning({ ...input, acsResourceId: input.acsResourceId.replace('rg-vfuture-academy-sg', 'unrelated') })).toThrow(/ACS/);
  });
  it('requires an immutable VM image and rejects credential-bearing inputs', () => {
    expect(() => validateProvisioning({ ...input, imageVersion: 'latest' })).toThrow(/image/);
    expect(() => validateProvisioning({ ...input, password: 'forbidden' })).toThrow(/unexpected/);
  });
});

describe('runtime deployment admission', () => {
  const compose = () => JSON.parse(readFileSync(new URL('../../infra/azure/runtime/compose.json', import.meta.url), 'utf8'));
  it('accepts the pinned private baseline, rejecting direct DB exposure', () => {
    const config = compose();
    expect(validateRuntime(config)).toEqual([]);
    config.services.db.ports = ['5432:5432'];
    expect(validateRuntime(config)).toContain('db: host ports are forbidden');
  });
  it('rejects unbounded memory, unpinned images and resident administration', () => {
    const config = compose();
    config.services.auth.mem_limit = '4g';
    config.services.storage.image = 'supabase/storage-api:latest';
    delete config.services.meta.profiles;
    const errors = validateRuntime(config);
    expect(errors).toContain('resident memory exceeds 2624 MiB');
    expect(errors).toContain('storage: image must include a sha256 digest');
    expect(errors).toContain('meta: operator profile is required');
  });
  it('rejects pool expansion and public metadata endpoints', () => {
    const config = compose();
    config.services.auth.environment.GOTRUE_DB_MAX_POOL_SIZE = '40';
    config.services.studio.ports = ['3000:3000'];
    expect(validateRuntime(config)).toContain('Auth pool exceeds 4');
    expect(validateRuntime(config)).toContain('studio: only loopback operator access is allowed');
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('operator bootstrap safety', () => {
  it('keeps generated secrets in an exclusive 0600 file and never prints them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'academy-secret-test-'));
    const target = join(dir, 'runtime.env');
    const settings = { SUPABASE_PUBLIC_URL: 'https://backend.example.com', ACADEMY_SITE_URL: 'https://academy.example.com', AUTH_REDIRECT_URLS: 'https://academy.example.com/auth/callback', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'test', SMTP_PASS: 'synthetic-mail-password', SMTP_ADMIN_EMAIL: 'noreply@example.com' };
    try {
      const result = spawnSync('python3', ['infra/azure/scripts/create-runtime-secrets.py', target], { input: JSON.stringify(settings), encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toContain(settings.SMTP_PASS);
      expect(statSync(target).mode & 0o777).toBe(0o600);
      const content = readFileSync(target, 'utf8');
      expect(content).toContain('SERVICE_ROLE_KEY=');
      const repeated = spawnSync('python3', ['infra/azure/scripts/create-runtime-secrets.py', target], { input: JSON.stringify(settings), encoding: 'utf8' });
      expect(repeated.status).toBe(1);
      expect(readFileSync(target, 'utf8')).toBe(content);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects stale or overlong controls before replacing the gateway maintenance file', () => {
    const script = `import importlib.util,datetime,json,sys
spec=importlib.util.spec_from_file_location('host','infra/azure/scripts/azure-host.py')
host=importlib.util.module_from_spec(spec); spec.loader.exec_module(host)
now=datetime.datetime(2026,10,25,12,tzinfo=datetime.timezone.utc)
host.validate_control(json.load(sys.stdin),now)
print('accepted')`;
    const control = { version: 1, mode: 'normal', updatedAt: '2026-10-25T11:59:00Z', expiresAt: '2026-10-25T12:14:00Z' };
    expect(execFileSync('python3', ['-c', script], { input: JSON.stringify(control), encoding: 'utf8' }).trim()).toBe('accepted');
    for (const expiresAt of ['2026-10-25T11:59:30Z', '2026-10-25T13:00:00Z']) {
      const result = spawnSync('python3', ['-c', script], { input: JSON.stringify({ ...control, expiresAt }), encoding: 'utf8' });
      expect(result.status).toBe(1);
    }
  });
});

describe('backup retention safety', () => {
  it('retains distinct daily, weekly and monthly recovery points and never prunes current uploads', () => {
    const script = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('backup','infra/azure/scripts/upload-backup.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
rows=json.load(sys.stdin)
print(json.dumps(m.retention_deletions(rows,'academy-daily-20261025.tar.age')))`;
    const rows = Array.from({ length: 100 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 25 - index));
      return { name: `academy-daily-${date.toISOString().slice(0, 10).replaceAll('-', '')}.tar.age`, createdAt: date.toISOString() };
    });
    const expired = JSON.parse(execFileSync('python3', ['-c', script], { input: JSON.stringify(rows), encoding: 'utf8' }));
    expect(expired).not.toContain('academy-daily-20261025.tar.age');
    expect(expired).not.toContain('academy-daily-20261019.tar.age');
    expect(expired).not.toContain('academy-daily-20260930.tar.age');
    expect(expired).not.toContain('academy-daily-20260831.tar.age');
    expect(expired).toContain('academy-daily-20260720.tar.age');
    expect(rows.length - expired.length).toBeLessThanOrEqual(14);
  });
});

it('counts soft-deleted and pending backup bytes plus a failed-upload reserve before admitting capacity', () => {
  const script = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('backup','infra/azure/scripts/upload-backup.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps([m.capacity_allowed(*(v*1024**3 for v in row)) for row in json.load(sys.stdin)]))`;
  const actual = JSON.parse(execFileSync('python3', ['-c', script], { input: JSON.stringify([[168, 84, 0, 12], [168, 84, 36, 12], [168, 84, 0, 13], [-1, 0, 0, 1]]), encoding: 'utf8' }));
  expect(actual).toEqual([true, false, false, false]);
});

it('resumes only from fresh normal control issued after the completed backup receipt', () => {
  const script = `import importlib.util,datetime,json
spec=importlib.util.spec_from_file_location('backup','infra/azure/scripts/backup-coordinator.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=datetime.datetime.now(datetime.timezone.utc)
receipt={'recordedAt':(now-datetime.timedelta(seconds=30)).isoformat()}
control={'version':1,'mode':'normal','updatedAt':(now-datetime.timedelta(seconds=10)).isoformat(),'expiresAt':(now+datetime.timedelta(minutes=5)).isoformat()}
print(json.dumps([m.can_resume(control,receipt),m.can_resume({**control,'mode':'drain'},receipt),m.can_resume({**control,'updatedAt':(now-datetime.timedelta(seconds=60)).isoformat()},receipt),m.can_resume({**control,'expiresAt':(now-datetime.timedelta(seconds=1)).isoformat()},receipt),m.scheduled_control_matches({'mode':'drain','drainReason':'scheduled-backup','backupRequestId':'other','drainStartedAt':now.isoformat()},'expected')]))`;
  expect(JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))).toEqual([true, false, false, false, false]);
});

it('detects object corruption in a decrypted backup before extraction', () => {
  const script = `import importlib.util,tempfile,tarfile,io,json,hashlib,pathlib
spec=importlib.util.spec_from_file_location('archive','infra/azure/scripts/verify-backup-archive.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def archive(path,content):
 manifest={'version':1,'objects':[{'path':'example.txt','bytes':4,'sha256':hashlib.sha256(b'good').hexdigest()}]}
 with tarfile.open(path,'w') as tar:
  for name,data in [('database.dump',b'synthetic-dump'),('roles.sql',b'synthetic-roles'),('runtime.env',b'synthetic-env'),('host-telemetry-state.json',b'{"sequence":1}'),('manifest.json',json.dumps(manifest).encode()),('objects/example.txt',content)]:
   info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
with tempfile.TemporaryDirectory() as directory:
 path=pathlib.Path(directory)/'backup.tar';archive(path,b'good');valid=m.verify(path)
 archive(path,b'evil')
 try:m.verify(path);corrupt=False
 except ValueError:corrupt=True
 print(json.dumps([valid,corrupt]))`;
  expect(JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))).toEqual([1, true]);
});

it('retries the exact persisted checkpoint after a failed upload and records acknowledgement only after read-back', () => {
  const script = `import importlib.util,tempfile,pathlib,json
spec=importlib.util.spec_from_file_location('backup','infra/azure/scripts/backup-coordinator.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
receipt={'version':1,'vmResourceId':'vm','drainStartedAt':'2026-10-25T00:00:00Z','recordedAt':'2026-10-25T00:01:00Z','activeRequests':0,'activeExamAttempts':0,'databaseFlushed':True,'backupCompleted':True,'backupReference':'archive'}
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory);remote=p/'remote.json'
 def read(config):return (json.loads(remote.read_text()),'etag-1') if remote.exists() else (None,None)
 def fail(*args):raise OSError('synthetic transport failure')
 try:m.publish_checkpoint({'vmResourceId':'vm'},receipt,p,fail,read)
 except OSError:pass
 before=(p/'checkpoint.json').exists() and not (p/'checkpoint-published.json').exists()
 pending=json.loads((p/'checkpoint.json').read_text())
 def send(config,name,value,headers=None):remote.write_text(json.dumps(value))
 m.publish_checkpoint({'vmResourceId':'vm'},pending,p,send,read)
 after=json.loads(remote.read_text())==receipt and (p/'checkpoint-published.json').exists()
 print(json.dumps([before,after,json.loads(remote.read_text())['recordedAt']]))`;
  expect(JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))).toEqual([true, true, '2026-10-25T00:01:00Z']);
});

it('allows an independently ordered financial snapshot with in-progress rows but refuses a daily backup that would interrupt exams', () => {
  const script = `import importlib.util,json
spec=importlib.util.spec_from_file_location('backup','infra/azure/scripts/backup-coordinator.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
financial={'mode':'drain','drainReason':'financial','drainStartedAt':'2026-10-25T00:00:00Z'}
scheduled={**financial,'drainReason':'scheduled-backup','backupRequestId':'daily'}
print(json.dumps([m.snapshot_admitted(financial,25,None),m.snapshot_admitted(scheduled,25,'daily'),m.snapshot_admitted(scheduled,0,'daily'),m.snapshot_admitted({**financial,'mode':'discretionary-stop'},25,None),m.snapshot_admitted(scheduled,0,None)]))`;
  expect(JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))).toEqual([true, false, true, false, false]);
});

it('the extracted Function package loads and fails closed without configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'academy-package-test-'));
  try {
    const zip = join(dir, 'guard.zip');
    execFileSync('python3', ['infra/azure/scripts/package-guard.py', zip]);
    execFileSync('python3', ['-m', 'zipfile', '-e', zip, join(dir, 'extracted')]);
    const script = `const timer=require(process.argv[1]); if(typeof timer!=='function')process.exit(2); timer({log:{error(){},warn(){}}}).then(()=>process.exit(3),e=>{if(e.message!=='cost-guard-configuration-failed')process.exit(4);console.log('package-loads-and-fails-closed')});`;
    expect(execFileSync(process.execPath, ['-e', script, join(dir, 'extracted/timer/index.cjs')], { env: { ...process.env, COST_GUARD_CONFIG_JSON: 'null' }, encoding: 'utf8' }).trim()).toBe('package-loads-and-fails-closed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('the deployment policy rejects a VM using an allowed disk name while admitting the declared type/name pair', () => {
  const condition = JSON.parse(readFileSync(new URL('../../infra/azure/inventory-policy.json', import.meta.url), 'utf8'));
  const allowed = ['microsoft.compute/virtualmachines|academy-sg-vm', 'microsoft.compute/disks|academy-sg-data'];
  type Clause = { allOf?: Clause[]; field?: string; value?: string; notIn?: string | string[] };
  function denied(clause: Clause, resource: Record<string, string>): boolean {
    if (clause.allOf) return clause.allOf.every(child => denied(child, resource));
    let actual = clause.field ? resource[clause.field] : '';
    if (clause.value) {
      const expression = clause.value.match(/^\[concat\(toLower\(field\('([^']+)'\)\), '([^']+)', toLower\(field\('([^']+)'\)\)\)\]$/);
      if (!expression) throw new Error('Unsupported policy value expression');
      actual = resource[expression[1]].toLowerCase() + expression[2] + resource[expression[3]].toLowerCase();
    }
    const candidates = Array.isArray(clause.notIn) ? clause.notIn : allowed;
    return !candidates.some(candidate => candidate.toLowerCase() === actual.toLowerCase());
  }
  expect(denied(condition, { type: 'Microsoft.Compute/virtualMachines', fullName: 'academy-sg-vm' })).toBe(false);
  expect(denied(condition, { type: 'Microsoft.Compute/virtualMachines', fullName: 'academy-sg-data' })).toBe(true);
  expect(denied(condition, { type: 'Microsoft.Compute/disks', fullName: 'academy-sg-data' })).toBe(false);
  expect(denied(condition, { type: 'Microsoft.Compute/disks', fullName: 'academy-sg-vm' })).toBe(true);
});

it('seeds the baked pinned-image configuration on a clean disk and preserves existing durable keys', () => {
  const script = `import importlib.util,tempfile,pathlib,shutil,json
spec=importlib.util.spec_from_file_location('seed','infra/azure/scripts/seed-postgres-config.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as directory:
 root=pathlib.Path(directory);source=root/'image-config';source.mkdir(mode=0o755);(source/'conf.d').mkdir()
 for name in ('supautils.conf','wal-g.conf','read-replica.conf'):(source/name).write_text('baked '+name)
 target=root/'postgres-config';target.mkdir(mode=0o700)
 image='supabase/postgres:17.6.1.136@sha256:'+'a'*64
 def docker(args):
  if args[:4]==['docker','create','--entrypoint','/bin/true']:
   if args[4]!=image:raise ValueError('wrong image')
   return 'a'*64
  if args[:3]==['docker','cp','-a']:
   if args[3]!='a'*64+':/etc/postgresql-custom':raise ValueError('wrong source')
   shutil.copytree(source,pathlib.Path(args[4])/'postgresql-custom');return ''
  if args[:2]==['docker','rm']:return ''
  raise ValueError('unexpected Docker operation')
 m.seed_config(target,image,docker)
 (target/'pgsodium_root.key').write_text('synthetic-durable-key')
 (source/'supautils.conf').write_text('changed-image-file')
 m.seed_config(target,image,docker)
 print(json.dumps([(target/'supautils.conf').read_text(),(target/'pgsodium_root.key').read_text(),target.stat().st_mode&0o777]))`;
  expect(JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))).toEqual(['baked supautils.conf', 'synthetic-durable-key', 0o755]);
});
