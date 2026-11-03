import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { preflight, validateParameters, policy } from './preflight.mjs';

try {
  const mode = process.argv[2];
  const base = process.argv.includes('--base');
  const path = resolve(process.argv[3] ?? '');
  if (!['--what-if', '--apply'].includes(mode) || !process.argv[3]) throw new Error('Usage: node infra/azure-core/deploy.mjs --what-if|--apply /private/parameters.json [--scheduler-receipt=/private/receipt.json]');
  if ((statSync(path).mode & 0o077) !== 0) throw new Error('Parameter file must have mode 0600 and live outside Git');
  try { execFileSync('git', ['check-ignore', '--quiet', path], { stdio: 'ignore' }); } catch { throw new Error('Parameter file must be ignored by Git (use build/azure-core/parameters.json)'); }
  const receiptArg = process.argv.find(arg => arg.startsWith('--scheduler-receipt='));
  let schedulerReceipt = false;
  if (receiptArg) {
    const receipt = JSON.parse(readFileSync(receiptArg.slice('--scheduler-receipt='.length), 'utf8'));
    schedulerReceipt = receipt.legacyPgCronDisabled === true && receipt.vercelCronDisabled === true && receipt.onlyOwner === 'azure-functions' && Date.now() - Date.parse(receipt.observedAt) < 86400000;
  }
  validateParameters(JSON.parse(readFileSync(path, 'utf8')), { schedulerReceipt, base });
  preflight({ email: !base });
  execFileSync('az', ['deployment', 'group', mode === '--apply' ? 'create' : 'what-if', '--subscription', policy.subscriptionId, '--resource-group', policy.resourceGroup, '--name', base ? 'academy-core-base' : 'academy-core', '--template-file', base ? 'infra/azure-core/base.bicep' : 'infra/azure-core/main.bicep', '--parameters', `@${path}`, '--mode', 'Incremental', '--only-show-errors'], { stdio: 'inherit' });
} catch (error) { console.error(error.message); process.exitCode = 1; }
