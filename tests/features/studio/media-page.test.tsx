import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const assets = [
    { id: 'asset_FIRST', mime: 'image/png', sizeBytes: 1, width: 1, height: 1, filename: 'first.png', alt: { vi: '', en: '' }, createdAt: null },
    { id: 'asset_SECOND', mime: 'image/png', sizeBytes: 1, width: 1, height: 1, filename: 'second.png', alt: { vi: '', en: '' }, createdAt: null },
    { id: 'asset_THIRD', mime: 'image/png', sizeBytes: 1, width: 1, height: 1, filename: 'third.png', alt: { vi: '', en: '' }, createdAt: null },
  ];
  const service = {
    listAssets: vi.fn().mockResolvedValue(assets),
    usages: vi.fn().mockResolvedValue([]),
    usagesForAssets: vi.fn().mockResolvedValue(new Map(assets.map((asset) => [asset.id, []]))),
  };
  return {
    assets,
    service,
    requirePermission: vi.fn().mockResolvedValue({ userId: 'editor-1', roles: [{ role: 'editor', branchId: null }] }),
    createMediaLibraryService: vi.fn(() => service),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn().mockResolvedValue((key: string) => key) }));
vi.mock('@/lib/permissions', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => ({})) }));
vi.mock('@/features/media/library', () => ({ createMediaLibraryService: mocks.createMediaLibraryService }));
vi.mock('@/features/admin/content-review-production', () => ({
  typedContentPageContext: async () => ({ actor: await mocks.requirePermission('media.upload'), scope: { kind: 'central' } }),
}));

import StudioMediaPage from '@/app/studio/media/page';

describe('Studio media page queries', () => {
  it('loads usages for every asset in one batch', async () => {
    await StudioMediaPage();

    expect(mocks.requirePermission).toHaveBeenCalledTimes(1);
    expect(mocks.service.listAssets).toHaveBeenCalledTimes(1);
    expect(mocks.service.usagesForAssets).toHaveBeenCalledTimes(1);
    expect(mocks.service.usagesForAssets).toHaveBeenCalledWith(mocks.assets.map((asset) => asset.id));
    expect(mocks.service.usages).not.toHaveBeenCalled();
  });
});
