import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://academy.example' } }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import { createCertificateService } from '@/features/certificates/service';
import { renderCertificatePdf } from '@/features/certificates/CertificateDocument';
import { SupabaseStub, successful } from '../learner/test-kit';

function certificateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'certificate-1',
    user_id: 'learner-1',
    course_id: 'course-1',
    course_version_id: 'version-1',
    serial: 'VFA-2026-ABCDEFGH',
    verification_code: '11111111-1111-4111-8111-111111111111',
    issued_at: '2026-09-03T12:00:00.000Z',
    pdf_asset_id: 'asset-certificate-1',
    ...overrides,
  };
}

function storageDouble() {
  return {
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example/certificate.pdf?token=signed' },
      error: null,
    }),
  };
}

describe('certificate service', () => {
  it('renders Vietnamese learner and course text with the real PDF renderer', async () => {
    const pdf = await renderCertificatePdf({
      learnerName: 'Nguyễn Ánh',
      courseTitle: 'Nền tảng Trí tuệ nhân tạo',
      locale: 'vi',
      issuedAt: '2026-09-03T12:00:00.000Z',
      serial: 'VFA-2026-ABCDEFGH',
      verificationUrl: 'https://academy.example/verify/11111111-1111-4111-8111-111111111111',
    });

    expect(pdf.byteLength).toBeGreaterThan(1_000);
  });

  it('retries a colliding serial and records a certificate with the required format', async () => {
    const database = new SupabaseStub({
      certificates: [
        successful(null),
        successful({ id: 'taken' }),
        successful(null),
        successful(certificateRow({ serial: 'VFA-2026-JKMNPQRS' })),
      ],
      profiles: [successful({ display_name: 'Nguyen An', locale: 'en' })],
      course_version_outline: [successful({
        meta: { title: { vi: 'Nhap mon AI', en: 'AI Foundations' } },
        default_language: 'vi',
      })],
      media_assets: [successful({ id: 'asset-certificate-1' })],
    });
    const storage = storageDouble();
    const renderPdf = vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const serialParts = ['ABCDEFGH', 'JKMNPQRS'];
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      now: () => new Date('2026-09-03T12:00:00.000Z'),
      randomSerialPart: () => serialParts.shift()!,
      randomUuid: vi.fn()
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('certificate-1'),
      createAssetId: () => 'asset-certificate-1',
      appUrl: 'https://academy.example',
      renderPdf,
    });

    const issued = await service.issue('learner-1', 'course-1', 'version-1');

    expect(issued.serial).toBe('VFA-2026-JKMNPQRS');
    expect(issued.serial).toMatch(/^VFA-2026-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({
      learnerName: 'Nguyen An',
      courseTitle: 'AI Foundations',
      serial: 'VFA-2026-JKMNPQRS',
      verificationUrl: 'https://academy.example/verify/11111111-1111-4111-8111-111111111111',
    }));
    expect(storage.upload).toHaveBeenCalledOnce();
  });

  it('returns an existing per-course certificate without rendering or uploading again', async () => {
    const database = new SupabaseStub({ certificates: [successful(certificateRow())] });
    const storage = storageDouble();
    const renderPdf = vi.fn();
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      renderPdf,
      appUrl: 'https://academy.example',
    });

    await expect(service.issue('learner-1', 'course-1', 'version-2')).resolves.toMatchObject({
      id: 'certificate-1', courseId: 'course-1', courseVersionId: 'version-1',
    });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('bounds PDF strings, falls back to the handle, uses Vietnam serial years, and hides identifiers in storage paths', async () => {
    const longHandle = `learner-${'x'.repeat(140)}`;
    const longCourseTitle = `Course ${'y'.repeat(140)}`;
    const database = new SupabaseStub({
      certificates: [
        successful(null),
        successful(null),
        successful(certificateRow({
          serial: 'VFA-2027-ABCDEFGH',
          issued_at: '2026-12-31T18:00:00.000Z',
        })),
      ],
      profiles: [successful({ display_name: '   ', handle: longHandle, locale: 'en' })],
      course_version_outline: [successful({
        meta: { title: { vi: longCourseTitle, en: longCourseTitle } },
        default_language: 'en',
      })],
      media_assets: [successful({ id: 'asset-certificate-1' })],
    });
    const storage = storageDouble();
    const renderPdf = vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      now: () => new Date('2026-12-31T18:00:00.000Z'),
      randomSerialPart: () => 'ABCDEFGH',
      randomUuid: vi.fn()
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('certificate-1'),
      randomStorageSegment: () => 'unguessable-storage-segment',
      createAssetId: () => 'asset-certificate-1',
      appUrl: 'https://academy.example',
      renderPdf,
    });

    await service.issue('learner-1', 'course-1', 'version-1');

    expect(renderPdf).toHaveBeenCalledWith(expect.objectContaining({
      learnerName: longHandle.slice(0, 120),
      courseTitle: longCourseTitle.slice(0, 120),
      serial: 'VFA-2027-ABCDEFGH',
    }));
    expect(storage.upload).toHaveBeenCalledWith(
      'unguessable-storage-segment/certificate-1.pdf',
      expect.any(Uint8Array),
      expect.any(Object),
    );
  });

  it('returns the concurrently issued user-course certificate after a 23505 race', async () => {
    const concurrent = certificateRow({ id: 'certificate-concurrent' });
    const database = new SupabaseStub({
      certificates: [
        successful(null),
        successful(null),
        { data: null, error: { code: '23505', message: 'duplicate user/course' } },
        successful(concurrent),
      ],
      profiles: [successful({ display_name: 'Nguyen An', handle: 'nguyen-an', locale: 'en' })],
      course_version_outline: [successful({
        meta: { title: { vi: 'Nhap mon AI', en: 'AI Foundations' } },
        default_language: 'vi',
      })],
      media_assets: [successful({ id: 'asset-certificate-1' }), successful(null)],
    });
    const storage = storageDouble();
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      now: () => new Date('2026-09-03T12:00:00.000Z'),
      randomSerialPart: () => 'ABCDEFGH',
      randomUuid: vi.fn()
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('certificate-1'),
      randomStorageSegment: () => 'random-path',
      createAssetId: () => 'asset-certificate-1',
      appUrl: 'https://academy.example',
      renderPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
    });

    await expect(service.issue('learner-1', 'course-1', 'version-1'))
      .resolves.toMatchObject({ id: 'certificate-concurrent' });
    expect(storage.remove).toHaveBeenCalledWith(['random-path/certificate-1.pdf']);
  });

  it('signs a certificate artifact for ten minutes only after a valid verification-code lookup', async () => {
    const database = new SupabaseStub({
      certificates: [successful(certificateRow())],
      profiles: [successful({ display_name: 'Nguyen An', handle: 'nguyen-an', locale: 'en' })],
      course_version_outline: [successful({
        meta: { title: { vi: 'Nhap mon AI', en: 'AI Foundations' } },
        default_language: 'vi',
      })],
      media_assets: [successful({
        owner_id: 'learner-1', bucket: 'certificates', path: 'random/certificate-1.pdf',
      })],
    });
    const storage = storageDouble();
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      renderPdf: vi.fn(),
      appUrl: 'https://academy.example',
    });

    await expect(service.verify('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      serial: 'VFA-2026-ABCDEFGH',
      pdfUrl: 'https://storage.example/certificate.pdf?token=signed',
    });
    expect(storage.createSignedUrl).toHaveBeenCalledWith('random/certificate-1.pdf', 10 * 60);
  });

  it('creates an owner-only signed download while hiding other learners certificates', async () => {
    const database = new SupabaseStub({
      certificates: [successful(certificateRow())],
      media_assets: [successful({
        owner_id: 'learner-1', bucket: 'certificates', path: 'random/certificate-1.pdf',
      })],
    });
    const storage = storageDouble();
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      renderPdf: vi.fn(),
      appUrl: 'https://academy.example',
    });

    await expect(service.downloadForUser('learner-1', 'certificate-1')).resolves.toBe(
      'https://storage.example/certificate.pdf?token=signed',
    );
    expect(database.queriesFor('certificates')[0].operations).toEqual(expect.arrayContaining([
      ['eq', 'id', 'certificate-1'],
      ['eq', 'user_id', 'learner-1'],
    ]));
  });

  it('returns null for an unknown verification code', async () => {
    const database = new SupabaseStub({ certificates: [successful(null)] });
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn() } }),
      renderPdf: vi.fn(),
      appUrl: 'https://academy.example',
    });

    await expect(service.verify('11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
  });

  it('rejects malformed verification codes before database or storage access', async () => {
    const database = new SupabaseStub();
    const storage = storageDouble();
    const service = createCertificateService({
      database: Object.assign(database, { storage: { from: vi.fn(() => storage) } }),
      renderPdf: vi.fn(),
      appUrl: 'https://academy.example',
    });

    await expect(service.verify('not-a-verification-code')).resolves.toBeNull();
    expect(database.queries).toHaveLength(0);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
