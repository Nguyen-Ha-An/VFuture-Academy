import { validateArchiveListing } from './archive-policy.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync,renameSync,rmSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const folder = resolve('infra/azure-core/functions');
if (!existsSync(`${folder}/node_modules/@azure/functions`)) throw new Error('Run npm ci --prefix infra/azure-core/functions --ignore-scripts first');
execFileSync(process.execPath,['infra/azure-core/verify.mjs'],{stdio:'inherit'});
mkdirSync('build/azure-core',{recursive:true});
const output=resolve('build/azure-core/functions.zip');
// Explicit allowlist prevents local.settings.json, environment files and operator receipts entering the release.
const temporary=resolve(`build/azure-core/functions-${randomUUID()}.zip`);
try {
  execFileSync('zip',['-q','-r',temporary,'host.json','package.json','package-lock.json','src','node_modules','-x','._*','*/._*','__MACOSX/*','*/__MACOSX/*','.DS_Store','*/.DS_Store'],{cwd:folder,stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'}});
  validateArchiveListing(execFileSync('unzip',['-Z1',temporary],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),{kind:'functions'});
  renameSync(temporary,output);
} finally { if(existsSync(temporary))rmSync(temporary); }
const sha256=createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync('build/azure-core/functions-package-receipt.json',JSON.stringify({path:output,sha256,createdAt:new Date().toISOString()},null,2)+'\n');
console.log(`Functions package: ${output}; SHA256 ${sha256}`);
