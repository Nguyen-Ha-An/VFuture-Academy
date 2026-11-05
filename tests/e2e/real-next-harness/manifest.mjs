import { readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
export function readLocalManifest(file){
  const manifest=JSON.parse(readFileSync(file,'utf8'));
  if(manifest.kind!=='academy-real-next-local'||manifest.appOrigin!=='https://localhost:4452'||manifest.dataOrigin!=='https://localhost:4451'||manifest.postgres?.database!=='academy_route_fixture'||manifest.postgres?.user!=='academy_route_admin'||manifest.postgres?.port!==55447||typeof manifest.cluster!=='string'||!/^\/(?:private\/)?tmp\/academy-route\.[a-zA-Z0-9]+$/.test(resolve(manifest.cluster))||resolve(manifest.postgres.host)!==join(resolve(manifest.cluster),'socket'))throw new Error('Non-local fixture manifest refused');
  return manifest;
}
