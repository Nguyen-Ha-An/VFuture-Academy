import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function canonical(value) {
  // PostgreSQL renders timestamptz in the session zone. Compare the same instant
  // while preserving all six microsecond digits (JS Date alone truncates them).
  if(typeof value==='string') {
    const instant=/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if(instant) {
      const seconds=Date.parse(`${instant[1]}T${instant[2]}${instant[4]}`);
      if(Number.isFinite(seconds))return `${new Date(seconds).toISOString().slice(0,19)}.${(instant[3]??'').padEnd(6,'0')}Z`;
    }
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function tableDigest(rows) { return digest(rows.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))); }
export function snapshotReceipt(snapshot) {
  return { format:1, schemaSha256:snapshot.schemaSha256, tables:Object.fromEntries(Object.entries(snapshot.tables).map(([name,rows])=>[name,{rows:rows.length,sha256:tableDigest(rows)}])), users:{rows:snapshot.users.length,sha256:tableDigest(snapshot.users)}, storage:{objects:snapshot.storage.length,sha256:tableDigest(snapshot.storage)}, sequences:snapshot.sequences??null };
}
/** Paginated actual Storage API traversal, including objects with no app asset row. */
export async function inventoryStorage(storage) {
  const buckets = await storage.listBuckets();
  if (buckets.error || !buckets.data) throw new Error('Storage bucket inventory failed');
  const inventory=[];
  for (const bucket of buckets.data) {
    if (bucket.public) throw new Error('Migration requires private retained buckets');
    const queue=[''];
    for(let position=0;position<queue.length;position++) {
      if(queue.length>100000) throw new Error('Storage inventory traversal limit reached');
      const prefix=queue[position];
      for(let offset=0; ; offset+=100) {
        const page=await storage.from(bucket.id).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});
        if(page.error||!page.data) throw new Error('Storage object listing failed');
        for(const item of page.data) {
          const path=prefix?`${prefix}/${item.name}`:item.name;
          if(!item.id) { queue.push(path); continue; }
          const info=await storage.from(bucket.id).info(path);
          if(info.error||!info.data) throw new Error('Storage object metadata verification failed');
          const size=info.data.size??info.data.metadata?.size;
          const mime=info.data.contentType??info.data.metadata?.mimetype;
          if(!Number.isSafeInteger(Number(size))||Number(size)<0||typeof mime!=='string') throw new Error('Unverifiable Storage size/type');
          inventory.push({bucket_id:bucket.id,name:path,metadata:{size:Number(size),mimetype:mime}});
        }
        if(page.data.length<100) break;
      }
    }
  }
  return inventory.sort((a,b)=>`${a.bucket_id}/${a.name}`.localeCompare(`${b.bucket_id}/${b.name}`));
}
