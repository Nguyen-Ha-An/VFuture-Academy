import { describe, expect, it, vi } from 'vitest';
const direct=vi.hoisted(()=>vi.fn());
vi.mock('@/features/media/direct-upload-client',async original=>({...await original<typeof import('@/features/media/direct-upload-client')>(),directUploadFile:direct}));
import { uploadProjectCover } from '@/features/projects/ui/cover-upload';
import { DirectUploadError } from '@/features/media/direct-upload-client';
describe('project cover direct upload',()=>{
  it('preserves image response, progress and cancellation signal',async()=>{
    const result={assetId:'asset_one',url:'/api/v1/media/asset_one',name:'cover.png',size:3,mime:'image/png'};
    direct.mockImplementationOnce(async(_file,_context,options)=>{options.onProgress({loaded:2,total:4,percent:50});return result;});
    const file=new File(['png'],'cover.png',{type:'image/png'}), signal=new AbortController().signal,onProgress=vi.fn();
    await expect(uploadProjectCover(file,{signal,onProgress})).resolves.toEqual(result);
    expect(direct).toHaveBeenCalledWith(file,{purpose:'project_cover'},expect.objectContaining({signal}));expect(onProgress).toHaveBeenCalledWith(50);
  });
  it('preserves existing CoverUploadError codes for cancellation',async()=>{
    direct.mockRejectedValueOnce(new DirectUploadError('UPLOAD_CANCELLED','Upload cancelled'));
    await expect(uploadProjectCover(new File(['png'],'cover.png'))).rejects.toMatchObject({name:'CoverUploadError',code:'UPLOAD_CANCELLED'});
  });
});
