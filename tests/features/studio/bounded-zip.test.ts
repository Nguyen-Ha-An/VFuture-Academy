import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readBoundedZipEntry } from '@/features/studio/bounded-zip';

async function entry(bytes: Uint8Array, compression: 'STORE' | 'DEFLATE' = 'DEFLATE') {
  const zip = new JSZip();
  zip.file('entry.bin', bytes);
  return (await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression }))).file('entry.bin')!;
}

describe('bounded ZIP expansion', () => {
  it.each(['STORE', 'DEFLATE'] as const)('preserves binary bytes and UTF8 with %s', async (compression) => {
    const bytes = new TextEncoder().encode('Xin chào Việt Nam 👋');
    const file = await entry(bytes, compression);
    expect(await readBoundedZipEntry(file, { used: 0, entryLimit: 100, totalLimit: 100 })).toEqual(bytes);
  });

  it('rejects actual expansion even when declared size is small', async () => {
    const file = await entry(new Uint8Array(100_000));
    (file as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = 1;
    const budget = { used: 0, entryLimit: 1000, totalLimit: 2000 };
    await expect(readBoundedZipEntry(file, budget)).rejects.toMatchObject({ code: 'BUNDLE_ENTRY_TOO_LARGE' });
    expect(budget.used).toBeLessThanOrEqual(1000);
  });

  it('counts actual bytes across entries before retaining the excess chunk', async () => {
    const budget = { used: 0, entryLimit: 100, totalLimit: 100 };
    await readBoundedZipEntry(await entry(new Uint8Array(60)), budget);
    await expect(readBoundedZipEntry(await entry(new Uint8Array(60)), budget))
      .rejects.toMatchObject({ code: 'BUNDLE_UNCOMPRESSED_TOO_LARGE' });
    expect(budget.used).toBe(60);
  });

  it('rejects a declared size mismatch under the actual limit', async () => {
    const file = await entry(new Uint8Array(40));
    (file as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = 1;
    await expect(readBoundedZipEntry(file, { used: 0, entryLimit: 100, totalLimit: 100 }))
      .rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
  });
});
