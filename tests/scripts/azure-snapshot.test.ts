import { expect, it } from 'vitest';
import { inventoryStorage, tableDigest } from '../../scripts/azure-core/snapshot.mjs';
it('reconciliation ignores row/key order but detects changed/null values', () => {
  expect(tableDigest([{id:1,a:null},{id:2,a:'x'}])).toBe(tableDigest([{a:'x',id:2},{a:null,id:1}]));
  expect(tableDigest([{id:1,a:null}])).not.toBe(tableDigest([{id:1,a:''}]));
});
it('inventory traverses nested actual Storage objects and rejects unknown byte counts', async () => {
  const storage={listBuckets:async()=>({data:[{id:'media',public:false}]}),from:()=>({list:async(prefix:string)=>({data:prefix?[{id:'obj',name:'a.png'}]:[{name:'folder'}]}),info:async()=>({data:{size:3,contentType:'image/png'}})})};
  expect(await inventoryStorage(storage)).toEqual([{bucket_id:'media',name:'folder/a.png',metadata:{size:3,mimetype:'image/png'}}]);
  storage.from=()=>({list:async()=>({data:[{id:'obj',name:'a.png'}]}),info:async()=>({data:{}})}) as never;
  await expect(inventoryStorage(storage)).rejects.toThrow('Unverifiable');
});
it('compares timestamps across session time zones without dropping microseconds',()=>{
  expect(tableDigest([{at:'2026-11-02T12:00:00.123456+00:00'}])).toBe(tableDigest([{at:'2026-11-02T19:00:00.123456+07:00'}]));
  expect(tableDigest([{at:'2026-11-02T12:00:00.123456+00:00'}])).not.toBe(tableDigest([{at:'2026-11-02T12:00:00.123457+00:00'}]));
});
