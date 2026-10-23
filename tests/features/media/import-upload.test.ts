import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { uploadImportedMedia, validateImportedMedia } from '@/features/media/storage';

const actor = { userId: 'owner-1', roles: [] };

describe('imported media persistence', () => {
  it('reads dimensions from an ordinary PNG header', () => {
    const pngHeader = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x02, 0x80, 0x00, 0x00, 0x01, 0xe0,
    ]);

    expect(validateImportedMedia('lesson.png', pngHeader)).toMatchObject({
      mime: 'image/png',
      width: 640,
      height: 480,
    });
  });

  it('accepts an allowlisted AVIF with unavailable dimensions', () => {
    const avifHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70,
      0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
    ]);

    expect(validateImportedMedia('photo.avif', avifHeader)).toMatchObject({
      mime: 'image/avif',
      width: null,
      height: null,
    });
  });

  it('stores an imported asset and records its real private-media metadata', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const database = {
      storage: { from: vi.fn(() => ({ upload, remove })) },
      from: vi.fn(() => ({ insert })),
    };
    const bytes = new Uint8Array([37, 80, 68, 70]);

    const result = await uploadImportedMedia('guide.pdf', bytes, actor, {
      database,
      createId: () => 'asset_01TEST',
    });

    expect(upload).toHaveBeenCalledWith('media/asset_01TEST/guide.pdf', bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(insert).toHaveBeenCalledWith({
      id: 'asset_01TEST',
      owner_id: 'owner-1',
      bucket: 'media',
      path: 'media/asset_01TEST/guide.pdf',
      purpose: 'content',
      mime: 'application/pdf',
      size_bytes: 4,
      width: null,
      height: null,
    });
    expect(result).toMatchObject({ id: 'asset_01TEST', url: '/api/v1/media/asset_01TEST' });
  });

  it('rejects an unsupported imported asset before touching storage', async () => {
    const database = { storage: { from: vi.fn() }, from: vi.fn() };

    await expect(uploadImportedMedia('script.svg', new Uint8Array([1]), actor, { database }))
      .rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA' });
    expect(database.storage.from).not.toHaveBeenCalled();
  });
});
