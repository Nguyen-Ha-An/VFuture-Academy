import { expect,it,vi } from 'vitest';
import { reconcileExpiredStorageHolds } from '@/lib/storage/retained-storage';
it('releases expired holds only on observed absence and retains actual abandoned bytes',async()=>{
  const rpc=vi.fn(async(name:string)=>name==='academy_storage_expired_holds'?{data:[{bucket_id:'notebooks',name:'pending/a',observed_at:'old'}],error:null}:{data:true,error:null});
  const info=vi.fn(async()=>({data:null,error:{statusCode:'503'}}));
  const db={rpc,storage:{from:()=>({info})}};
  expect(await reconcileExpiredStorageHolds(db as never)).toEqual({inspected:1,reconciled:0});
  expect(rpc).toHaveBeenCalledTimes(1);
  info.mockResolvedValueOnce({data:null,error:{statusCode:'404'}});
  expect(await reconcileExpiredStorageHolds(db as never)).toEqual({inspected:1,reconciled:1});
  expect(rpc).toHaveBeenLastCalledWith('academy_storage_reconcile_hold',{p_bucket:'notebooks',p_path:'pending/a',p_observed_at:'old',p_metadata:null});
  info.mockResolvedValueOnce({data:{size:1024,contentType:'application/json'},error:null} as never);
  await reconcileExpiredStorageHolds(db as never);
  expect(rpc).toHaveBeenLastCalledWith('academy_storage_reconcile_hold',{p_bucket:'notebooks',p_path:'pending/a',p_observed_at:'old',p_metadata:{size:1024,mimetype:'application/json'}});
});
