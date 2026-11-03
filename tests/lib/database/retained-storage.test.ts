import { expect, it, vi } from 'vitest';
import { withVerifiedInventory } from '@/lib/storage/retained-storage';
it('does not accept successful writes without actual Storage metadata and durable inventory', async () => {
  const upload = vi.fn(async () => ({ data: { path: 'p' }, error: null }));
  const info = vi.fn(async () => ({ data: { size: 12, contentType: 'image/png' }, error: null }));
  const rpc = vi.fn(async () => ({ error: null }));
  const wrapped = withVerifiedInventory({ from: () => ({ upload, info }) } as never, { rpc } as never);
  await wrapped.from('media').upload('p', new Uint8Array(12));
  expect(info).toHaveBeenCalledWith('p');
  expect(rpc).toHaveBeenCalledWith('academy_storage_observe', { p_bucket: 'media', p_path: 'p', p_metadata: { size: 12, mimetype: 'image/png' } });
  rpc.mockResolvedValueOnce({ error: { message: 'unavailable' } } as never);
  await expect(wrapped.from('media').upload('p', new Uint8Array(12))).rejects.toThrow('inventory');
});
it('never drops quota on an ambiguous removal or a remaining object', async () => {
  const rpc = vi.fn(async () => ({ error: null }));
  const info = vi.fn(async () => ({ data: { size: 12 }, error: null }));
  const wrapped = withVerifiedInventory({ from: () => ({ remove: async () => ({ data: [], error: null }), info }) } as never, { rpc } as never);
  await expect(wrapped.from('media').remove(['p'])).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
  info.mockResolvedValueOnce({ data: null, error: { statusCode: '404' } } as never);
  await wrapped.from('media').remove(['p']);
  expect(rpc).toHaveBeenCalledWith('academy_storage_observe', { p_bucket: 'media', p_path: 'p', p_metadata: null });
});
it('rejects signed transfers without a verified native bucket cap', async () => {
  const sign=vi.fn();
  const rpc=vi.fn(async()=>({error:null}));
  const storage={getBucket:async()=>({data:{file_size_limit:null},error:null}),from:()=>({createSignedUploadUrl:sign})};
  const wrapped=withVerifiedInventory(storage as never,{rpc} as never);
  await expect(wrapped.from('media').createSignedUploadUrl('pending')).rejects.toThrow('native Storage bucket limit');
  expect(sign).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});
it('records the actual native token expiry before returning a bounded private upload URL',async()=>{
  const expiry=Math.floor(Date.now()/1000)+7200;
  const token=`e30.${Buffer.from(JSON.stringify({exp:expiry})).toString('base64url')}.signature`;
  const signedUrl=`https://storage.example.test/upload?token=${token}`;
  const sign=vi.fn(async()=>({data:{signedUrl},error:null}));
  const rpc=vi.fn(async()=>({error:null}));
  const storage={getBucket:async()=>({data:{public:false,file_size_limit:10485760},error:null}),from:()=>({createSignedUploadUrl:sign})};
  const wrapped=withVerifiedInventory(storage as never,{rpc} as never);
  expect((await wrapped.from('notebooks').createSignedUploadUrl('pending/a')).data?.signedUrl).toBe(signedUrl);
  expect(rpc).toHaveBeenLastCalledWith('academy_storage_confirm_signed',{p_bucket:'notebooks',p_path:'pending/a',p_expires_at:new Date(expiry*1000).toISOString()});
});
it('reconciles an already-missing remove response only after independent object-info confirms 404',async()=>{
  const rpc=vi.fn(async()=>({error:null}));
  const info=vi.fn(async()=>({data:null,error:{statusCode:'404'}}));
  const storage={from:()=>({remove:async()=>({data:null,error:{statusCode:'404'}}),info})};
  const wrapped=withVerifiedInventory(storage as never,{rpc} as never);
  expect((await wrapped.from('media').remove(['gone'])).error).toBeNull();
  expect(rpc).toHaveBeenCalledWith('academy_storage_observe',{p_bucket:'media',p_path:'gone',p_metadata:null});
  info.mockResolvedValueOnce({data:null,error:{statusCode:'503'}});
  await expect(wrapped.from('media').remove(['uncertain'])).rejects.toThrow('verification');
});
