// Source inventory only. A file or HTTP200 never establishes rendered/functional coverage.
import { readdir,readFile } from 'node:fs/promises';
import { resolve,relative,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
async function walk(folder){return(await Promise.all((await readdir(folder,{withFileTypes:true})).map(entry=>entry.isDirectory()?walk(join(folder,entry.name)):[join(folder,entry.name)]))).flat();}
const entries=[];
for(const file of (await walk(join(root,'src/app'))).filter(file=>/\/(page|route)\.tsx?$/.test(file))){
  const source=await readFile(file,'utf8');
  const route='/'+relative(join(root,'src/app'),dirname(file)).split('/').filter(part=>!/^\(.*\)$/.test(part)&&part!=='.').join('/');
  entries.push({route,sourceFile:relative(root,file),kind:/\/route\.ts$/.test(file)?'api-handler':'page-source',literalRedirectTargets:[...source.matchAll(/\bredirect\(\s*['"]([^'"]+)['"]/g)].map(match=>match[1]),evidence:'source existence only',rendered:false,functional:false});
}
const aliases=await readFile(join(root,'src/lib/staff-legacy-redirects.ts'),'utf8');
for(const match of aliases.matchAll(/\['([^']+)',\s*'([^']+)'\]/g))entries.push({route:match[1],canonicalRoute:match[2],sourceFile:'src/lib/staff-legacy-redirects.ts',kind:'configured-alias-source',evidence:'literal configured redirect inventory only',rendered:false,functional:false});
for(const area of ['bank','resources','opportunities','projects'])entries.push({route:`/admin/${area}/:path*`,canonicalRoute:`/studio/${area}/:path*`,sourceFile:'src/lib/staff-legacy-redirects.ts',kind:'configured-alias-source',evidence:'fixed contentAreas mapping source only',rendered:false,functional:false});
console.log(JSON.stringify({kind:'actual-root-source-inventory',boundaries:['The prior85entry ledger is a scoped subset, not all root page files','No browser,render,redirect execution or permission proof is claimed','Dynamic parameters need concrete seeded route/state evidence'],entries},null,2));
