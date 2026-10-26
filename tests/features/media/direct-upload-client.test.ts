import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { directUploadFile } from '@/features/media/direct-upload-client';
const result={assetId:'asset_one',name:'work.txt',size:8,mime:'text/plain'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(status===200?{data}:{error:data}),{status});
const file=()=>new File(['homework'],'work.txt',{type:'text/plain'});
afterEach(()=>vi.unstubAllGlobals());
describe('direct upload client',()=>{
  it('sends only small JSON to the app and raw bytes directly to Storage, preserving the result',async()=>{
    const fetch=vi.fn(async(url:string,init:RequestInit)=>url.endsWith('/reserve')?response({uploadId:JSON.parse(String(init.body)).uploadId,uploadUrl:'https://storage.test/signed',method:'PUT'}):url.includes('/finalize')?response(result):new Response('{}'));
    const input=file();
    await expect(directUploadFile(input,{purpose:'submission',courseId:'course',itemId:'item',blockId:null},{fetchImpl:fetch as unknown as typeof globalThis.fetch})).resolves.toEqual(result);
    const request=JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(request).toMatchObject({name:'work.txt',size:8,mime:'text/plain',blockId:null});
    expect(request.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(fetch.mock.calls[1]).toEqual(['https://storage.test/signed',expect.objectContaining({method:'PUT',body:input,credentials:'omit'})]);
    expect(fetch.mock.calls.every(([url])=>url!=='/api/v1/uploads')).toBe(true);
  });
  it('uses XHR only for direct storage progress and finalizes afterward',async()=>{
    const open=vi.fn(), send=vi.fn(); let progress:(event:ProgressEvent)=>void;
    class Xhr {status=200; upload={addEventListener:(_name:string,listener:typeof progress)=>{progress=listener;}}; listeners=new Map<string,()=>void>(); open=open; setRequestHeader=vi.fn(); addEventListener=(name:string,fn:()=>void)=>this.listeners.set(name,fn); send=(value:unknown)=>{send(value);progress({loaded:4,total:8,lengthComputable:true} as ProgressEvent);this.listeners.get('load')?.();};abort=()=>this.listeners.get('abort')?.();}
    vi.stubGlobal('XMLHttpRequest',Xhr);
    const fetch=vi.fn().mockResolvedValueOnce(response({uploadId:'id',uploadUrl:'https://storage.test/signed',method:'PUT'})).mockResolvedValueOnce(response(result));
    const onProgress=vi.fn(); const input=file();
    await directUploadFile(input,{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch,onProgress});
    expect(open).toHaveBeenCalledWith('PUT','https://storage.test/signed');expect(send).toHaveBeenCalledWith(input);
    expect(onProgress).toHaveBeenCalledWith({loaded:4,total:8,percent:50});expect(onProgress).toHaveBeenLastCalledWith({loaded:8,total:8,percent:100});
  });
  it('reuses the same reservation and obtains a fresh grant after a lost transfer',async()=>{
    let grants=0;
    const fetch=vi.fn(async(url:string,init:RequestInit)=>{
      if(url.endsWith('/reserve'))return response({uploadId:JSON.parse(String(init.body)).uploadId,uploadUrl:`https://storage.test/${++grants}`,method:'PUT'});
      if(url==='https://storage.test/1')throw new TypeError('offline');
      if(url.includes('/finalize'))return grants===1?response({code:'UPLOAD_NOT_FOUND',message:'not uploaded'},404):response(result);
      return new Response('{}');
    });
    await expect(directUploadFile(file(),{purpose:'submission',courseId:'course',itemId:'item'},{fetchImpl:fetch as unknown as typeof globalThis.fetch})).resolves.toEqual(result);
    const bodies=fetch.mock.calls.filter(([url])=>url.endsWith('/reserve')).map(([,init])=>JSON.parse(String(init.body)));
    expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);
  });
  it('aborts in-flight transfer and requests owner cancellation without the aborted signal',async()=>{
    const controller=new AbortController();
    const fetch=vi.fn(async(url:string,init:RequestInit)=>{
      if(url.endsWith('/reserve'))return response({uploadId:JSON.parse(String(init.body)).uploadId,uploadUrl:'https://storage.test/signed',method:'PUT'});
      if(url==='https://storage.test/signed'){controller.abort();throw new DOMException('aborted','AbortError');}
      return response({cancelled:true});
    });
    await expect(directUploadFile(file(),{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch,signal:controller.signal})).rejects.toMatchObject({code:'UPLOAD_CANCELLED'});
    expect(fetch.mock.calls.at(-1)?.[1]).toMatchObject({method:'DELETE'});expect(fetch.mock.calls.at(-1)?.[1].signal).toBeUndefined();
  });
  it('cancels even when abort loses the reservation response',async()=>{
    const controller=new AbortController();
    const fetch=vi.fn(async(url:string)=>{
      if(url.endsWith('/reserve')){controller.abort();throw new DOMException('aborted','AbortError');}
      return response({cancelled:true});
    });
    await expect(directUploadFile(file(),{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch,signal:controller.signal})).rejects.toMatchObject({code:'UPLOAD_CANCELLED'});
    expect(fetch.mock.calls.at(-1)?.[0]).not.toBe('/api/v1/uploads/reserve');
  });
  it('cancels an expired reservation so the next explicit retry can reserve a new id',async()=>{
    const fetch=vi.fn(async(url:string)=>url.endsWith('/reserve')?response({code:'UPLOAD_EXPIRED',message:'expired'},409):response({cancelled:true}));
    const input=file();
    await expect(directUploadFile(input,{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch})).rejects.toMatchObject({code:'UPLOAD_EXPIRED'});
    expect(fetch.mock.calls.at(-1)?.[0]).not.toBe('/api/v1/uploads/reserve');
  });
  it('never falls back to multipart for a large failed direct transfer',async()=>{
    const fetch=vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(directUploadFile(new File([new Uint8Array(5*1024*1024)],'work.txt',{type:'text/plain'}),{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch})).rejects.toThrow();
    expect(fetch.mock.calls.every(([url,init])=>url==='/api/v1/uploads/reserve'&&typeof init.body==='string')).toBe(true);
  });
  it('does not reserve when already aborted or when the file is empty/oversize',async()=>{
    vi.stubGlobal('crypto',webcrypto);const fetch=vi.fn(); const signal=AbortSignal.abort();
    await expect(directUploadFile(file(),{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch,signal})).rejects.toMatchObject({code:'UPLOAD_CANCELLED'});
    await expect(directUploadFile(new File([],'work.txt'),{purpose:'avatar'},{fetchImpl:fetch as unknown as typeof globalThis.fetch})).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
