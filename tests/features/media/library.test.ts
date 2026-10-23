import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createMediaLibraryService, type MediaLibraryDatabase } from '@/features/media/library';

function query(data: unknown) {
  const state = {
    updateValue: undefined as unknown,
    select: vi.fn(function (this: unknown) { return this; }),
    order: vi.fn(function (this: unknown) { return this; }),
    limit: vi.fn(function (this: unknown) { return this; }),
    range: vi.fn(function (this: unknown) { return this; }),
    update: vi.fn(function (this: unknown, value: unknown) { state.updateValue = value; return this; }),
    eq: vi.fn(function (this: unknown) { return this; }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); },
  };
  return state;
}

describe('media library service', () => {
  it('lists only reusable authoring assets from the media bucket', async () => {
    const mediaQuery = query([
      { id: 'asset_MEDIA', bucket: 'media', path: 'media/asset_MEDIA/lesson.png', mime: 'image/png', size_bytes: 10, width: 1, height: 1, alt: {}, created_at: null },
      { id: 'asset_SUBMISSION', bucket: 'submissions', path: 'learner/asset_SUBMISSION/work.pdf', mime: 'application/pdf', size_bytes: 20, width: null, height: null, alt: {}, created_at: null },
      { id: 'asset_CERTIFICATE', bucket: 'certificates', path: 'certificates/asset_CERTIFICATE/cert.pdf', mime: 'application/pdf', size_bytes: 30, width: null, height: null, alt: {}, created_at: null },
    ]);
    const database = { from: vi.fn(() => mediaQuery) } as unknown as MediaLibraryDatabase;

    await expect(createMediaLibraryService({ database, authorize: vi.fn() }).listAssets()).resolves.toEqual([
      expect.objectContaining({ id: 'asset_MEDIA', filename: 'lesson.png' }),
    ]);
    expect(mediaQuery.eq).toHaveBeenCalledWith('bucket', 'media');
    expect(mediaQuery.eq).toHaveBeenCalledWith('purpose', 'content');
  });

  it('scopes a school media library to owned assets and hides cross-content usage scans', async () => {
    const mediaQuery = query([]);
    const database = { from: vi.fn(() => mediaQuery) } as unknown as MediaLibraryDatabase;
    const service = createMediaLibraryService({
      database,
      authorize: vi.fn(),
      scope: { kind: 'branch', branchId: 'ans' },
    });

    await service.listAssets();
    await expect(service.usagesForAssets(['asset_TARGET'])).resolves.toEqual(new Map([['asset_TARGET', []]]));

    expect(mediaQuery.eq).toHaveBeenCalledWith('ownership_kind', 'branch');
    expect(mediaQuery.eq).toHaveBeenCalledWith('owner_branch_id', 'ans');
    expect(database.from).toHaveBeenCalledTimes(1);
  });

  it('loads usage documents once and indexes references for every requested asset', async () => {
    const rows: Record<string, ReturnType<typeof query>> = {
      course_draft_items: query([
        { draft_id: 'draft-1', item_id: 'lesson-1', document: { blocks: [{ media: { assetId: 'asset_FIRST' } }, { media: { assetId: 'asset_SECOND' } }] } },
        { draft_id: 'draft-1', item_id: 'lesson-2', document: { media: { assetId: 'asset_FIRST' } } },
      ]),
      course_drafts: query([{ id: 'draft-1', course_id: 'course-a' }]),
      course_version_items: query([
        { version_id: 'version-1', item_id: 'exam-1', source: { cover: { assetId: 'asset_SECOND' } } },
      ]),
      course_versions: query([{ id: 'version-1', course_id: 'course-b', version: 3 }]),
      course_version_item_renders: query([
        { version_id: 'version-1', item_id: 'exam-2', payload: { audio: { assetId: 'asset_THIRD' } } },
      ]),
      bank_question_versions: query([
        { question_id: 'bank-one', version: 2, payload: { prompt: { assetId: 'asset_THIRD' } }, renders: {}, grading: {} },
      ]),
      resources: query([
        { id: 'resource-a', document: { attachments: [{ src: { assetId: 'asset_FIRST' } }] } },
      ]),
      projects: query([
        { id: 'project-a', cover_asset_id: 'asset_SECOND' },
      ]),
    };
    const database = { from: vi.fn((table: string) => rows[table]) } as unknown as MediaLibraryDatabase;
    const authorize = vi.fn().mockResolvedValue(undefined);

    const result = await createMediaLibraryService({ database, authorize })
      .usagesForAssets(['asset_FIRST', 'asset_SECOND', 'asset_THIRD']);

    expect(result.get('asset_FIRST')).toEqual([
      { source: 'draft', courseId: 'course-a', itemId: 'lesson-1', version: null },
      { source: 'draft', courseId: 'course-a', itemId: 'lesson-2', version: null },
      { source: 'resource', resourceId: 'resource-a' },
    ]);
    expect(result.get('asset_SECOND')).toEqual([
      { source: 'draft', courseId: 'course-a', itemId: 'lesson-1', version: null },
      { source: 'version', courseId: 'course-b', itemId: 'exam-1', version: 3 },
      { source: 'project', projectId: 'project-a' },
    ]);
    expect(result.get('asset_THIRD')).toEqual([
      { source: 'version', courseId: 'course-b', itemId: 'exam-2', version: 3 },
      { source: 'bank_version', questionId: 'bank-one', version: 2 },
    ]);
    expect(database.from).toHaveBeenCalledTimes(8);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(Object.values(rows).every((value) => value.range.mock.calls.length === 1)).toBe(true);
  });

  it('continues usage scans after a full database page instead of truncating at a fixed limit', async () => {
    const filler = Array.from({ length: 500 }, (_, index) => ({
      draft_id: 'draft-1', item_id: `lesson-${index}`, document: {},
    }));
    const calls: number[] = [];
    const database = {
      from: vi.fn((table: string) => {
        const state = { start: 0 };
        const chain = {
          select: vi.fn(() => chain),
          order: vi.fn(() => chain),
          range: vi.fn((start: number) => { state.start = start; calls.push(start); return chain; }),
          then: (resolve: (value: unknown) => unknown) => {
            const data = table === 'course_draft_items'
              ? state.start === 0 ? filler : [{ draft_id: 'draft-1', item_id: 'target', document: { src: { assetId: 'asset_TARGET' } } }]
              : table === 'course_drafts' ? [{ id: 'draft-1', course_id: 'course-a' }]
              : [];
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return chain;
      }),
    } as unknown as MediaLibraryDatabase;

    const result = await createMediaLibraryService({ database, authorize: vi.fn() }).usages('asset_TARGET');

    expect(result).toContainEqual({ source: 'draft', courseId: 'course-a', itemId: 'target', version: null });
    expect(calls).toContain(500);
  });

  it('finds exact assetId references in draft and immutable version item documents', async () => {
    const rows: Record<string, ReturnType<typeof query>> = {
      course_draft_items: query([
        { draft_id: 'draft-1', item_id: 'lesson-1', document: { blocks: [{ src: { assetId: 'asset_TARGET' } }] } },
        { draft_id: 'draft-1', item_id: 'lesson-2', document: { text: 'asset_TARGET' } },
      ]),
      course_drafts: query([{ id: 'draft-1', course_id: 'course-a' }]),
      course_version_items: query([{ version_id: 'version-1', item_id: 'exam-1', source: { cover: { assetId: 'asset_TARGET' } } }]),
      course_versions: query([{ id: 'version-1', course_id: 'course-b', version: 3 }]),
      course_version_item_renders: query([]),
      bank_question_versions: query([]),
      resources: query([]),
      projects: query([]),
    };
    const database = { from: vi.fn((table: string) => rows[table]) } as unknown as MediaLibraryDatabase;
    const authorize = vi.fn().mockResolvedValue(undefined);

    const result = await createMediaLibraryService({ database, authorize }).usages('asset_TARGET');

    expect(result).toEqual([
      { source: 'draft', courseId: 'course-a', itemId: 'lesson-1', version: null },
      { source: 'version', courseId: 'course-b', itemId: 'exam-1', version: 3 },
    ]);
    expect(authorize).toHaveBeenCalledWith('media.upload');
  });

  it('supports imported asset IDs accepted by the content contract in bulk usage lookup', async () => {
    const id = 'recovery-resource-asset-legacy';
    const rows: Record<string, ReturnType<typeof query>> = {
      course_draft_items: query([]), course_drafts: query([]), course_version_items: query([]),
      course_versions: query([]), course_version_item_renders: query([]),
      bank_question_versions: query([]),
      resources: query([{ id: 'resource-a', document: { attachments: [{ src: { assetId: id } }] } }]),
      projects: query([]),
    };
    const authorize = vi.fn();
    const service = createMediaLibraryService({ database: { from: vi.fn((table: string) => rows[table]) } as unknown as MediaLibraryDatabase, authorize });
    await expect(service.usagesForAssets([id])).resolves.toEqual(new Map([[id, [{ source: 'resource', resourceId: 'resource-a' }]]]));
    expect(authorize).toHaveBeenCalledWith('media.upload');
  });

  it('persists bilingual alt text only after media.upload authorization', async () => {
    const mediaQuery = query({ id: 'asset_TARGET', bucket: 'media', alt: { vi: 'Sơ đồ', en: 'Diagram' } });
    const database = { from: vi.fn(() => mediaQuery) } as unknown as MediaLibraryDatabase;
    const authorize = vi.fn().mockResolvedValue(undefined);

    await createMediaLibraryService({ database, authorize }).updateAlt('asset_TARGET', { vi: 'Sơ đồ', en: 'Diagram' });

    expect(authorize).toHaveBeenCalledWith('media.upload');
    expect(mediaQuery.updateValue).toEqual({ alt: { vi: 'Sơ đồ', en: 'Diagram' } });
    expect(mediaQuery.eq).toHaveBeenCalledWith('id', 'asset_TARGET');
    expect(mediaQuery.eq).toHaveBeenCalledWith('bucket', 'media');
    expect(mediaQuery.eq).toHaveBeenCalledWith('purpose', 'content');
  });

  it('refuses to edit alt text when a non-library bucket row is returned defensively', async () => {
    const mediaQuery = query({ id: 'asset_TARGET', bucket: 'submissions', alt: { vi: '', en: '' } });
    const database = { from: vi.fn(() => mediaQuery) } as unknown as MediaLibraryDatabase;

    await expect(createMediaLibraryService({ database, authorize: vi.fn() })
      .updateAlt('asset_TARGET', { vi: 'Không được phép', en: 'Not allowed' }))
      .rejects.toMatchObject({ status: 404, code: 'MEDIA_NOT_FOUND' });
    expect(mediaQuery.eq).toHaveBeenCalledWith('bucket', 'media');
  });
});
