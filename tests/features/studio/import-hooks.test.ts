import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  importBundleAsActor: vi.fn(),
  uploadImportedMedia: vi.fn(),
  validateImportedMedia: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/features/bank/service', () => ({ importBundleAsActor: mocks.importBundleAsActor }));
vi.mock('@/features/media/storage', () => ({
  uploadImportedMedia: mocks.uploadImportedMedia,
  validateImportedMedia: mocks.validateImportedMedia,
}));
vi.mock('@/lib/permissions', () => ({ hasPermission: mocks.hasPermission }));

import { productionBundleImportHooks } from '@/features/studio/import-hooks';
import type { Actor } from '@/lib/permissions';

const actor: Actor = { userId: 'owner-1', roles: [{ role: 'editor', branchId: null }] };

describe('production bundle import hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.importBundleAsActor.mockResolvedValue([]);
    mocks.uploadImportedMedia.mockResolvedValue({ id: 'asset_REAL' });
    mocks.validateImportedMedia.mockReturnValue({ filename: 'cover.png' });
    mocks.hasPermission.mockImplementation((candidate: Actor, permission: string) =>
      (permission === 'media.upload' || permission === 'bank.edit')
      && candidate.roles.some(({ role }) => role === 'editor' || role === 'admin'));
  });

  it('persists question bundles through the actor-bound bank importer', async () => {
    const document = { kind: 'question_bundle', id: 'basics' };

    await productionBundleImportHooks(actor).importQuestions?.(document, actor);

    expect(mocks.importBundleAsActor).toHaveBeenCalledWith(document, actor);
  });

  it('persists archive assets through media storage and returns the real asset id', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(productionBundleImportHooks(actor).uploadMedia?.('cover.png', bytes))
      .resolves.toEqual({ assetId: 'asset_REAL' });
    expect(mocks.uploadImportedMedia).toHaveBeenCalledWith('cover.png', bytes, actor);
  });

  it('preflights archive assets with the same validator used by persistence', async () => {
    const bytes = new Uint8Array([1, 2, 3]);

    await productionBundleImportHooks(actor).validateMedia?.('cover.png', bytes);

    expect(mocks.validateImportedMedia).toHaveBeenCalledWith('cover.png', bytes);
    expect(mocks.uploadImportedMedia).not.toHaveBeenCalled();
  });

  it('requires media.upload before persisting an archive asset', async () => {
    const denied: Actor = { userId: 'instructor-1', roles: [{ role: 'instructor', branchId: null }] };

    await expect(productionBundleImportHooks(denied).uploadMedia?.('cover.png', new Uint8Array([1])))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(mocks.uploadImportedMedia).not.toHaveBeenCalled();
  });

  it('preflights media.upload and bank.edit for a bundle that contains both', async () => {
    await productionBundleImportHooks(actor).preflightPersistence?.(
      { hasAssets: true, hasQuestions: true },
      actor,
    );

    expect(mocks.hasPermission).toHaveBeenCalledWith(actor, 'media.upload');
    expect(mocks.hasPermission).toHaveBeenCalledWith(actor, 'bank.edit');
    expect(mocks.uploadImportedMedia).not.toHaveBeenCalled();
    expect(mocks.importBundleAsActor).not.toHaveBeenCalled();
  });

  it('denies missing media.upload during preflight before storage writes', async () => {
    mocks.hasPermission.mockImplementation((_candidate: Actor, permission: string) => permission === 'bank.edit');

    await expect(productionBundleImportHooks(actor).preflightPersistence?.(
      { hasAssets: true, hasQuestions: false },
      actor,
    )).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(mocks.uploadImportedMedia).not.toHaveBeenCalled();
    expect(mocks.importBundleAsActor).not.toHaveBeenCalled();
  });

  it('denies missing bank.edit during preflight before any persistence writes', async () => {
    mocks.hasPermission.mockImplementation((_candidate: Actor, permission: string) => permission === 'media.upload');

    await expect(productionBundleImportHooks(actor).preflightPersistence?.(
      { hasAssets: false, hasQuestions: true },
      actor,
    )).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(mocks.uploadImportedMedia).not.toHaveBeenCalled();
    expect(mocks.importBundleAsActor).not.toHaveBeenCalled();
  });
});
