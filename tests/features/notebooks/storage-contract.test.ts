import { describe, expect, it } from 'vitest';
import { checkUpload, validateRevision } from '@/features/notebooks/upload-contract';
import { ApiError } from '@/lib/api';

describe('notebook upload boundary', () => {
  it('rejects executable/path filenames, oversized notebook and malformed checksums', () => {
    const file={purpose:'draft',filename:'work.ipynb',sizeBytes:100,checksum:'a'.repeat(64)};
    expect(()=>checkUpload(file)).not.toThrow();
    for(const bad of [{filename:'../work.ipynb'},{filename:'work.html'},{sizeBytes:5242881},{checksum:'invalid'}]) expect(()=>checkUpload({...file,...bad})).toThrow();
  });
  it('keeps datasets within the per-file limit and only accepts csv/json', () => {
    const file={purpose:'dataset',filename:'data.csv',sizeBytes:10485760,checksum:'b'.repeat(64)};
    expect(checkUpload(file).mime).toBe('text/csv');
    expect(()=>checkUpload({...file,sizeBytes:10485761})).toThrow();
    expect(()=>checkUpload({...file,filename:'setup.py'})).toThrow();
  });
  it('reports semantic upload validation as a client error', () => {
    for (const input of [
      {purpose:'draft',filename:'work.html',sizeBytes:100,checksum:'a'.repeat(64)},
      {purpose:'dataset',filename:'setup.py',sizeBytes:100,checksum:'a'.repeat(64)},
    ]) {
      try {
        checkUpload(input);
        throw new Error('expected validation error');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({status:415});
      }
    }
  });
  it('rejects unsafe revision values instead of overwriting a draft', () => {
    expect(validateRevision(0)).toBe(0);
    for(const revision of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'1']) expect(()=>validateRevision(revision)).toThrow();
  });
});
