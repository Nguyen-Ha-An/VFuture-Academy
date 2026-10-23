import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  repairRecoveryCertificateArtifact,
  type RecoveryCertificate,
  type RecoveryCertificateAsset,
  type RecoveryCertificateStore,
} from '../../scripts/lib/recovery-certificate-artifacts';

const userId = '11111111-1111-4111-8111-111111111111';
const email = 'completed@example.com';
const verificationCode = '22222222-2222-4222-8222-222222222222';
const verificationUrl = `https://staging.example/verify/${verificationCode}`;
const certificate: RecoveryCertificate = {
  id: '33333333-3333-4333-8333-333333333333',
  userId,
  courseId: 'ai-foundations',
  courseVersionId: '44444444-4444-4444-8444-444444444444',
  serial: 'VFA-2026-ABCDEFGH',
  verificationCode,
  issuedAt: '2026-09-05T00:00:00.000Z',
  pdfAssetId: 'asset-old',
};
const oldAsset: RecoveryCertificateAsset = {
  id: 'asset-old', ownerId: userId, bucket: 'certificates', path: 'legacy/certificate.pdf',
  mime: 'application/pdf', size: 10,
};

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function storeFixture(overrides: Partial<RecoveryCertificateStore> = {}) {
  let current = { ...certificate };
  const assets = new Map<string, RecoveryCertificateAsset>([[oldAsset.id, oldAsset]]);
  const storage = new Map<string, Uint8Array>([[oldAsset.path, Buffer.from('%PDF legacy')]]);
  const removed: string[] = [];
  const store: RecoveryCertificateStore = {
    authUser: vi.fn(async () => ({ id: userId, email, recoveryFixture: true })),
    certificate: vi.fn(async () => ({ ...current })),
    certificateDetails: vi.fn(async () => ({ learnerName: 'Nguyễn Ánh', courseTitle: 'AI Foundations', locale: 'en' as const })),
    asset: vi.fn(async (assetId) => assets.get(assetId) ?? null),
    download: vi.fn(async (path) => {
      const value = storage.get(path);
      if (!value) throw new Error('missing storage');
      return value;
    }),
    upload: vi.fn(async (path, bytes) => { storage.set(path, bytes); }),
    insertAsset: vi.fn(async (asset) => { assets.set(asset.id, asset); }),
    swapCertificateAsset: vi.fn(async (certificateId, expected, next) => {
      if (certificateId !== current.id || current.pdfAssetId !== expected) return false;
      current = { ...current, pdfAssetId: next };
      return true;
    }),
    readCertificate: vi.fn(async () => ({ ...current })),
    certificateReferenceCount: vi.fn(async (assetId) => current.pdfAssetId === assetId ? 1 : 0),
    deleteAsset: vi.fn(async (asset) => assets.delete(asset.id)),
    removeStorage: vi.fn(async (path) => { removed.push(path); storage.delete(path); }),
    ...overrides,
  };
  return { store, assets, storage, removed, current: () => current };
}

const repairInput = (store: RecoveryCertificateStore, renderPdf = vi.fn(async () => Buffer.from(
  `%PDF /FontFile2 /URI (${verificationUrl})`,
))) => ({
  store,
  expectedUserId: userId,
  expectedUserEmail: email,
  courseId: 'ai-foundations' as const,
  appUrl: 'https://staging.example/path-is-ignored',
  renderPdf,
  createAssetId: () => 'asset-new',
});

describe('seed certificate artifact repair', () => {
  it('refuses any user without the server-owned recovery marker before reading certificates', async () => {
    const { store } = storeFixture({
      authUser: vi.fn(async () => ({ id: userId, email, recoveryFixture: false })),
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(store))).rejects.toThrow('unverified recovery Auth user');
    expect(store.certificate).not.toHaveBeenCalled();
  });

  it('does not reupload a marked artifact with matching bytes, font, and canonical URI', async () => {
    const bytes = Buffer.from(`%PDF /FontFile2 /URI (${verificationUrl})`);
    const path = `seed-certificates/noto-v1/${certificate.id}/asset-old/none/${digest(bytes)}.pdf`;
    const currentAsset = { ...oldAsset, path, size: bytes.byteLength };
    const renderPdf = vi.fn();
    const { store } = storeFixture({
      asset: vi.fn(async () => currentAsset),
      download: vi.fn(async () => bytes),
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(store, renderPdf)))
      .resolves.toEqual({ status: 'unchanged', certificateId: certificate.id, oldArtifactRemoved: false });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(store.upload).not.toHaveBeenCalled();
  });

  it('retries exact old-artifact cleanup from the current marker without re-rendering', async () => {
    const bytes = Buffer.from(`%PDF /FontFile2 /URI (${verificationUrl})`);
    const currentCertificate = { ...certificate, pdfAssetId: 'asset-current' };
    const currentAsset: RecoveryCertificateAsset = {
      ...oldAsset,
      id: 'asset-current',
      path: `seed-certificates/noto-v1/${certificate.id}/asset-current/asset-old/${digest(bytes)}.pdf`,
      size: bytes.byteLength,
    };
    const deleteAsset = vi.fn(async () => true);
    const removeStorage = vi.fn(async () => undefined);
    const renderPdf = vi.fn();
    const { store } = storeFixture({
      certificate: vi.fn(async () => currentCertificate),
      asset: vi.fn(async (assetId) => assetId === 'asset-current' ? currentAsset : assetId === 'asset-old' ? oldAsset : null),
      download: vi.fn(async () => bytes),
      certificateReferenceCount: vi.fn(async (assetId) => assetId === 'asset-current' ? 1 : 0),
      deleteAsset,
      removeStorage,
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(store, renderPdf))).resolves.toEqual({
      status: 'unchanged', certificateId: certificate.id, oldArtifactRemoved: true,
    });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(removeStorage).toHaveBeenCalledWith(oldAsset.path);
    expect(deleteAsset).toHaveBeenCalledWith(oldAsset);
  });

  it('replaces only the PDF reference, verifies immutable readback, and removes an unreferenced old artifact', async () => {
    const { store, assets, storage, removed, current } = storeFixture();
    const original = { ...certificate };

    await expect(repairRecoveryCertificateArtifact(repairInput(store))).resolves.toEqual({
      status: 'repaired', certificateId: certificate.id, oldArtifactRemoved: true,
    });

    expect(current()).toEqual({ ...original, pdfAssetId: 'asset-new' });
    const next = assets.get('asset-new');
    expect(next?.path).toMatch(new RegExp(`^seed-certificates/noto-v1/${certificate.id}/asset-new/asset-old/[a-f0-9]{64}\\.pdf$`));
    expect(storage.has(next!.path)).toBe(true);
    expect(assets.has('asset-old')).toBe(false);
    expect(removed).toContain(oldAsset.path);
  });

  it('cleans the unreferenced replacement when the certificate CAS loses', async () => {
    const { store, assets, storage, removed, current } = storeFixture({
      swapCertificateAsset: vi.fn(async () => false),
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(store))).rejects.toThrow('compare-and-swap');

    expect(current()).toEqual(certificate);
    expect(assets.has('asset-new')).toBe(false);
    expect([...storage.keys()].some((path) => path.includes('asset-new'))).toBe(false);
    expect(removed.some((path) => path.includes('asset-new'))).toBe(true);
    expect(assets.get('asset-old')).toEqual(oldAsset);
  });

  it('reconciles a CAS that committed before its response threw and cleans only after rollback', async () => {
    const fixture = storeFixture();
    const actualSwap = fixture.store.swapCertificateAsset;
    let swaps = 0;
    fixture.store.swapCertificateAsset = vi.fn(async (id: string, expected: string | null, next: string | null) => {
      const result = await actualSwap(id, expected, next);
      swaps += 1;
      if (swaps === 1) throw new Error('CAS response lost');
      return result;
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(fixture.store))).rejects.toThrow('CAS response lost');

    expect(fixture.current()).toEqual(certificate);
    expect(fixture.assets.has('asset-new')).toBe(false);
    expect(fixture.removed.some((path) => path.includes('asset-new'))).toBe(true);
    expect(fixture.assets.get('asset-old')).toEqual(oldAsset);
  });

  it('never deletes a replacement that remains referenced after a rollback race', async () => {
    const fixture = storeFixture();
    const actualSwap = fixture.store.swapCertificateAsset;
    let swaps = 0;
    fixture.store.swapCertificateAsset = vi.fn(async (id: string, expected: string | null, next: string | null) => {
      swaps += 1;
      if (swaps === 1) {
        await actualSwap(id, expected, next);
        throw new Error('CAS response lost');
      }
      return false;
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(fixture.store))).rejects.toThrow('CAS response lost');

    expect(fixture.current().pdfAssetId).toBe('asset-new');
    expect(fixture.assets.has('asset-new')).toBe(true);
    expect([...fixture.storage.keys()].some((path) => path.includes('asset-new'))).toBe(true);
    expect(fixture.removed.some((path) => path.includes('asset-new'))).toBe(false);
  });

  it('re-reads and cleans exact metadata when its insert committed before throwing', async () => {
    const fixture = storeFixture();
    fixture.store.insertAsset = vi.fn(async (asset) => {
      fixture.assets.set(asset.id, asset);
      throw new Error('metadata response lost');
    });

    await expect(repairRecoveryCertificateArtifact(repairInput(fixture.store))).rejects.toThrow('metadata response lost');

    expect(fixture.current()).toEqual(certificate);
    expect(fixture.assets.has('asset-new')).toBe(false);
    expect([...fixture.storage.keys()].some((path) => path.includes('asset-new'))).toBe(false);
    expect(fixture.store.swapCertificateAsset).not.toHaveBeenCalled();
  });

  it('aggregates cleanup failures with the primary ambiguous write error', async () => {
    const fixture = storeFixture();
    fixture.store.insertAsset = vi.fn(async (asset) => {
      fixture.assets.set(asset.id, asset);
      throw new Error('metadata response lost');
    });
    fixture.store.removeStorage = vi.fn(async () => { throw new Error('storage cleanup failed'); });

    let failure: unknown;
    try { await repairRecoveryCertificateArtifact(repairInput(fixture.store)); } catch (error) { failure = error; }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'metadata response lost' }),
      expect.objectContaining({ message: 'storage cleanup failed' }),
    ]));
    expect(fixture.assets.has('asset-new')).toBe(true);
  });
});
