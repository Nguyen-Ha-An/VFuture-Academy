import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import { CourseDocumentSchema } from '@/content-engine/schema/course';
import { InMemoryResolver, inlineWorkspace, parseWorkspace } from '@/content-engine/validate';
import { encodeWorkspaceEnvelope } from '@/features/studio/content-transfer';
import { ApiError } from '@/lib/api';

const { serviceMock } = vi.hoisted(() => ({ serviceMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: serviceMock }));

import {
  createCourse,
  deleteItem,
  getDraft,
  importBundle,
  importNewCourse,
  importSingle,
  listCourses,
  previewItem,
  previewWorkspace,
  rewriteAssetReferences,
  saveItem,
  saveManifest,
  saveWorkspace,
  stubAssetId as stubAssetIdOf,
  validateDraft,
  type BundleImportHooks,
} from '@/features/studio/drafts';

type Result = { data: unknown; error: { message: string } | null };
type Operation = [string, ...unknown[]];

class QueryStub implements PromiseLike<Result> {
  readonly operations: Operation[] = [];

  constructor(readonly table: string, private readonly result: Result) {}

  select(columns: string) { this.operations.push(['select', columns]); return this; }
  insert(value: unknown) { this.operations.push(['insert', value]); return this; }
  update(value: unknown) { this.operations.push(['update', value]); return this; }
  upsert(value: unknown, options?: unknown) { this.operations.push(['upsert', value, options]); return this; }
  delete() { this.operations.push(['delete']); return this; }
  eq(column: string, value: unknown) { this.operations.push(['eq', column, value]); return this; }
  overlaps(column: string, value: string[]) { this.operations.push(['overlaps', column, value]); return this; }
  in(column: string, value: string[]) { this.operations.push(['in', column, value]); return this; }
  not(column: string, operator: string, value: unknown) { this.operations.push(['not', column, operator, value]); return this; }
  order(column: string, options?: unknown) { this.operations.push(['order', column, options]); return this; }
  limit(value: number) { this.operations.push(['limit', value]); return this; }
  async single() { return this.result; }
  async maybeSingle() { return this.result; }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class SupabaseStub {
  readonly queries: QueryStub[] = [];
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly results: Record<string, Result[]> = {},
    private readonly rpcResults: Record<string, Result[]> = {},
  ) {}

  from(table: string) {
    const query = new QueryStub(table, this.results[table]?.shift() ?? successful(null));
    this.queries.push(query);
    return query;
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'studio_get_draft_snapshot' && !this.rpcResults[name]?.length) {
      const draft = this.results.course_drafts?.shift()?.data;
      if (!draft) return successful(null);
      const rows = this.results.course_draft_items?.shift()?.data;
      const items = Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [
        (row as { item_id: string }).item_id,
        (row as { document: unknown }).document,
      ]));
      return successful({ ...(draft as Record<string, unknown>), items });
    }
    this.rpcCalls.push({ name, args });
    return this.rpcResults[name]?.shift() ?? successful(null);
  }
}

const actor = { userId: '00000000-0000-4000-8000-000000000001', roles: [{ role: 'editor' as const, branchId: null }] };
const successful = (data: unknown): Result => ({ data, error: null });
const draftRow = (manifest: unknown = FIXTURES['ai-foundations'].manifest) => ({
  id: 'draft-1', course_id: 'ai-foundations', manifest, base_version_id: null, checklist: {}, updated_at: '2026-09-02T00:00:00Z',
});
const itemRows = (items: Record<string, unknown> = FIXTURES['ai-foundations'].items) => Object.entries(items).map(([item_id, document]) => ({
  draft_id: 'draft-1', item_id, kind: (document as { kind: string }).kind, document, updated_at: '2026-09-02T00:00:00Z',
}));

function useClient(client: SupabaseStub) {
  serviceMock.mockReturnValue(client);
  return client;
}

/**
 * Every content write now runs the complete validation pipeline, which resolves
 * references. The fixture resolver stands in for the reference tables so these tests
 * exercise the write contract rather than a database stub's empty answers.
 */
const engineDeps = (client: SupabaseStub) => ({ client, resolver: fixtureResolver });

const draftSnapshot = (
  manifest: unknown = FIXTURES['ai-foundations'].manifest,
  items: Record<string, unknown> = FIXTURES['ai-foundations'].items,
  updatedAt = '2026-09-02T00:00:00Z',
) => ({ ...draftRow(manifest), updated_at: updatedAt, items });

const rpcNames = (client: SupabaseStub) => client.rpcCalls.map((call) => call.name);

const simpleLesson = (id: string) => ({
  schemaVersion: 1, kind: 'lesson', id, title: id, objectives: ['Learn it.'],
  blocks: [{ type: 'paragraph', content: [{ text: 'Body' }] }],
});

/** A course with nothing cross-referenced, so a delete can be judged on its own. */
const twoItemCourse = {
  schemaVersion: 1, kind: 'course', id: 'two-items', title: 'Two items', summary: 'Two items.',
  languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
  pathway: 'core-future-skills', learningOutcomes: ['Learn.'], access: { scope: 'global' },
  modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'keep' }, { type: 'lesson', id: 'drop' }] }],
};
const twoItemSnapshot = (updatedAt = '2026-09-02T00:00:00Z') => ({
  id: 'draft-2', course_id: 'two-items', manifest: twoItemCourse,
  items: { keep: simpleLesson('keep'), drop: simpleLesson('drop') },
  base_version_id: null, checklist: {}, updated_at: updatedAt,
});

const minimalResolver = (assets: string[] = []) => new InMemoryResolver({
  assets,
  opportunities: ['ai-build-sprint-01'],
});

/** A single-file course whose items are all inline — what importSingle actually accepts. */
const completeInlineMinimal = () => {
  const parsed = parseWorkspace(FIXTURES.minimal).parsed;
  if (!parsed) throw new Error('Fixture must parse');
  return inlineWorkspace(parsed) as unknown as Record<string, unknown>;
};

const minimalSnapshot = (updatedAt = '2026-09-02T00:00:00Z') => ({ id: 'draft-1', course_id: 'minimal', manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items, base_version_id: null, checklist: {}, updated_at: updatedAt });

beforeEach(() => {
  vi.restoreAllMocks();
  serviceMock.mockReset();
});

type FakeZipEntry = {
  name: string;
  unsafeOriginalName?: string;
  dir: boolean;
  unixPermissions?: number | string | null;
  uncompressedSize?: number;
  _data?: { uncompressedSize?: number };
  async: ReturnType<typeof vi.fn>;
};

function fakeZip(entries: FakeZipEntry[]) {
  const files = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  return {
    files,
    file: vi.fn((name: string) => files[name] ?? null),
  };
}

function fakeEntry(name: string, uncompressedSize: number, async = vi.fn().mockRejectedValue(new Error('entry async must not run'))): FakeZipEntry {
  return { name, dir: false, _data: { uncompressedSize }, async };
}

function questionBundle(questions: unknown[] = [{
  id: 'q1',
  type: 'true_false',
  content: { blocks: [{ type: 'paragraph', content: [{ text: 'True or false?' }] }] },
  correctAnswer: true,
}]) {
  return {
    schemaVersion: 1,
    kind: 'question_bundle',
    id: 'basics',
    languages: ['en'],
    defaultLanguage: 'en',
    questions,
  };
}

function patchZipFilename(bytes: Uint8Array, from: string, to: string): void {
  const source = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  if (source.byteLength !== replacement.byteLength) throw new Error('ZIP test filenames must have equal byte lengths');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let patched = 0;
  for (let offset = 0; offset <= bytes.byteLength - 30; offset += 1) {
    const signature = view.getUint32(offset, true);
    const isLocal = signature === 0x04034b50;
    const isCentral = signature === 0x02014b50;
    if (!isLocal && !isCentral) continue;
    const nameLengthOffset = offset + (isLocal ? 26 : 28);
    const nameOffset = offset + (isLocal ? 30 : 46);
    const nameLength = view.getUint16(nameLengthOffset, true);
    if (nameLength !== source.byteLength || nameOffset + nameLength > bytes.byteLength) continue;
    if (source.every((value, index) => bytes[nameOffset + index] === value)) {
      bytes.set(replacement, nameOffset);
      patched += 1;
    }
  }
  if (patched !== 2) throw new Error(`Expected to patch local and central ZIP names, patched ${patched}`);
}

async function validZipEnvelope(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('studio draft services', () => {
  it('lists courses newest first', async () => {
    const client = useClient(new SupabaseStub({ courses: [successful([{ id: 'course-2' }, { id: 'course-1' }])] }));

    await expect(listCourses()).resolves.toEqual([{ id: 'course-2' }, { id: 'course-1' }]);
    expect(client.queries[0].operations).toContainEqual(['order', 'updated_at', { ascending: false }]);
  });

  it('validates and atomically creates a course with its initial draft for the route actor', async () => {
    const course = { id: 'new-course', slug: 'new-course', owner_id: actor.userId, status: 'draft' };
    const draft = { id: 'draft-new', course_id: 'new-course' };
    const client = useClient(new SupabaseStub({}, { studio_create_course: [successful({ course, draft })] }));

    await expect(createCourse({
      id: 'new-course',
      title: { vi: 'Khoá học mới', en: 'New course' },
      languages: ['vi', 'en'],
      defaultLanguage: 'en',
      pathway: 'research-innovation',
      level: 'specialization',
    }, actor)).resolves.toMatchObject({ course, draft });
    expect(client.queries).toEqual([]);
    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]).toMatchObject({ name: 'studio_create_course', args: {
      p_course_id: 'new-course',
      p_actor_id: actor.userId,
    } });
    expect(CourseDocumentSchema.safeParse(client.rpcCalls[0].args.p_manifest).success).toBe(true);
    expect(client.rpcCalls[0].args.p_manifest).toMatchObject({
      id: 'new-course',
      slug: 'new-course',
      languages: ['vi', 'en'],
      defaultLanguage: 'en',
      pathway: 'research-innovation',
      level: 'specialization',
    });
  });

  it('creates a one-character id without deriving an invalid slug', async () => {
    const course = { id: 'a', owner_id: actor.userId, status: 'draft' };
    const draft = { id: 'draft-a', course_id: 'a' };
    const client = useClient(new SupabaseStub({}, { studio_create_course: [successful({ course, draft })] }));

    await expect(createCourse({
      id: 'a',
      title: { vi: 'A' },
      languages: ['vi'],
      defaultLanguage: 'vi',
      pathway: 'core-future-skills',
      level: 'foundation',
    }, actor)).resolves.toMatchObject({ course, draft });
    expect(client.rpcCalls[0]?.args.p_manifest).toMatchObject({ id: 'a', title: { vi: 'A' } });
    expect(client.rpcCalls[0]?.args.p_manifest).not.toHaveProperty('slug');
  });

  it('rejects a title that is blank in the selected default language before the atomic create RPC', async () => {
    const client = useClient(new SupabaseStub());

    await expect(createCourse({
      id: 'course',
      title: { vi: 'Khoá học', en: '  ' },
      languages: ['vi', 'en'],
      defaultLanguage: 'en',
      pathway: 'core-future-skills',
      level: 'foundation',
    }, actor)).rejects.toMatchObject({ status: 400, code: 'INVALID_COURSE' });
    expect(client.rpcCalls).toEqual([]);
  });

  it.each([
    ['an invalid id', { id: 'Bad ID', languages: ['vi'], defaultLanguage: 'vi' }],
    ['a default language outside the selected languages', { id: 'course', languages: ['vi'], defaultLanguage: 'en' }],
  ])('rejects %s before the atomic create RPC', async (_description, overrides) => {
    const client = useClient(new SupabaseStub());

    await expect(createCourse({
      title: { vi: 'Khoá học' },
      pathway: 'core-future-skills',
      level: 'foundation',
      ...overrides,
    }, actor)).rejects.toMatchObject({ status: 400, code: 'INVALID_COURSE' });
    expect(client.rpcCalls).toEqual([]);
  });

  it('loads a draft and indexes item documents by item id', async () => {
    useClient(new SupabaseStub({ course_drafts: [successful(draftRow())], course_draft_items: [successful(itemRows())] }));

    const draft = await getDraft('ai-foundations');

    expect(draft.courseId).toBe('ai-foundations');
    expect(Object.keys(draft.items)).toEqual(['what-is-ai', 'ml-vs-rules', 'exam-m1', 'final-product']);
  });

  it('loads a complete draft through one atomic snapshot RPC', async () => {
    const snapshot = { ...draftRow(), items: FIXTURES['ai-foundations'].items };
    const client = useClient(new SupabaseStub({}, { studio_get_draft_snapshot: [successful(snapshot)] }));

    await expect(getDraft('ai-foundations')).resolves.toMatchObject({ id: 'draft-1', items: snapshot.items });
    expect(client.rpcCalls).toEqual([{ name: 'studio_get_draft_snapshot', args: { course_id: 'ai-foundations' } }]);
    expect(client.queries).toEqual([]);
  });

  it('requires and forwards the draft revision when atomically saving a workspace', async () => {
    const updated = { ...draftRow(), updated_at: '2026-09-03T00:00:00Z', items: FIXTURES['ai-foundations'].items };
    const client = new SupabaseStub({}, { studio_save_draft_workspace: [successful({ conflict: false, draft: updated })] });

    await expect(saveWorkspace('ai-foundations', {
      manifest: FIXTURES['ai-foundations'].manifest,
      items: FIXTURES['ai-foundations'].items,
    }, actor, '2026-09-02T00:00:00Z', engineDeps(client))).resolves.toMatchObject({ updatedAt: '2026-09-03T00:00:00Z' });
    expect(client.rpcCalls[0]).toMatchObject({ name: 'studio_save_draft_workspace', args: {
      expected_updated_at: '2026-09-02T00:00:00Z',
      set_base_version: false,
    } });
    await expect(saveWorkspace('ai-foundations', {
      manifest: FIXTURES['ai-foundations'].manifest,
      items: FIXTURES['ai-foundations'].items,
    }, actor, null, engineDeps(new SupabaseStub()))).rejects.toMatchObject({ status: 428, code: 'PRECONDITION_REQUIRED' });
  });

  it('reports malformed workspace bodies as 422 validation failures', async () => {
    await expect(saveWorkspace('ai-foundations', { manifest: {} }, actor, '2026-09-02T00:00:00Z', {
      client: new SupabaseStub(),
    })).rejects.toMatchObject({ status: 422, code: 'INVALID_WORKSPACE' });
  });

  it('rejects immutable item identity and manifest alignment errors before saving', async () => {
    const items = structuredClone(FIXTURES['ai-foundations'].items);
    (items['what-is-ai'] as { id: string }).id = 'renamed-item';
    const client = useClient(new SupabaseStub());

    await expect(saveWorkspace('ai-foundations', {
      manifest: FIXTURES['ai-foundations'].manifest,
      items,
    }, actor, '2026-09-02T00:00:00Z')).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_WORKSPACE',
      issues: expect.arrayContaining([expect.objectContaining({ path: ['what-is-ai', 'id'] })]),
    });
    expect(client.rpcCalls).toEqual([]);
  });

  it('rejects duplicate nested ids before saving while leaving other semantic checks to validation', async () => {
    const items = structuredClone(FIXTURES['ai-foundations'].items);
    const exam = items['exam-m1'] as { sections: unknown[] };
    exam.sections.push(structuredClone(exam.sections[0]));

    await expect(saveWorkspace('ai-foundations', {
      manifest: FIXTURES['ai-foundations'].manifest,
      items,
    }, actor, '2026-09-02T00:00:00Z', { client: new SupabaseStub() })).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_WORKSPACE',
      issues: expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining('Duplicate') })]),
    });
  });

  it.each(['stored', 'unsaved', 'validation'] as const)('blocks foreign bank questions in %s workspace resolution using persisted ownership', async (operation) => {
    const manifest = { ...(FIXTURES['ai-foundations'].manifest as Record<string, unknown>), access: { scope: 'branches', branchIds: ['school-b'] } };
    const foreign = { id: 'ai-basics-001', ownership_kind: 'branch', owner_branch_id: 'school-b', current_version_id: 'secret-version', type: 'single_choice' };
    const client = new SupabaseStub({
      courses: [successful({ ownership_kind: 'branch', owner_branch_id: 'school-a' })],
      course_drafts: [successful(draftRow(manifest))],
      course_draft_items: [successful(itemRows())],
      bank_questions: [successful(foreign), successful({ ...foreign, id: 'ai-basics-002' }), successful([foreign])],
      bank_question_versions: [successful({ id: 'secret-version', payload: { correctAnswer: 'foreign-secret' } })],
    });
    if (operation === 'stored') {
      await expect(previewItem('ai-foundations', 'exam-m1', 'en', { client })).rejects.toMatchObject({ code: 'DRAFT_INVALID' });
    } else if (operation === 'unsaved') {
      const result = await previewWorkspace('ai-foundations', { manifest, items: FIXTURES['ai-foundations'].items, selectedRef: { kind: 'item', id: 'exam-m1' }, locale: 'en' }, true, { client });
      expect(result.report.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('foreign-secret');
    } else {
      expect((await validateDraft('ai-foundations', { publish: false }, { client })).ok).toBe(false);
    }
    expect(client.queries.some((query) => query.table === 'courses' && query.operations.some(([method, column, value]) => method === 'eq' && column === 'id' && value === 'ai-foundations'))).toBe(true);
    expect(client.queries.map((query) => query.table)).not.toContain('bank_question_versions');
  });

  it('previews unsaved content and strips grading for read-only callers', async () => {
    const preview = await previewWorkspace('ai-foundations', {
      manifest: FIXTURES['ai-foundations'].manifest,
      items: FIXTURES['ai-foundations'].items,
      selectedDocId: 'what-is-ai',
      locale: 'en',
    }, false, { client: new SupabaseStub(), resolver: fixtureResolver });

    expect(preview.report.ok).toBe(true);
    expect(preview.item).toMatchObject({ id: 'what-is-ai', renders: { en: expect.any(Object) } });
    expect(preview.item?.grading).toEqual({ questions: {}, quizzes: {}, rubrics: {}, activities: [] });
    expect(JSON.stringify(preview)).not.toContain('correctAnswer');
  });

  describe('preview selects a document by reference, not by label', () => {
    // A course whose item is legitimately called "manifest": the legacy string cannot
    // tell that apart from the course document, so the ref decides.
    const manifestNamedItem = {
      schemaVersion: 1, kind: 'course', id: 'collide', title: 'Collide', summary: 'Name collision.',
      languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
      pathway: 'core-future-skills', learningOutcomes: ['Learn.'], access: { scope: 'global' },
      modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'manifest' }] }],
    };
    const collidingItems = { manifest: simpleLesson('manifest') };
    const previewDeps = () => ({ client: new SupabaseStub(), resolver: new InMemoryResolver({}) });

    it('returns the item when previewing itemRef("manifest")', async () => {
      const preview = await previewWorkspace('collide', {
        manifest: manifestNamedItem,
        items: collidingItems,
        selectedRef: { kind: 'item', id: 'manifest' },
        locale: 'en',
      }, true, previewDeps());

      expect(preview.item).toMatchObject({ id: 'manifest' });
      expect(preview.course).not.toBeNull();
    });

    it('returns the course when previewing the course reference', async () => {
      const preview = await previewWorkspace('collide', {
        manifest: manifestNamedItem,
        items: collidingItems,
        selectedRef: { kind: 'course' },
        locale: 'en',
      }, true, previewDeps());

      expect(preview.item).toBeNull();
      expect(preview.course).toMatchObject({ meta: expect.any(Object) });
    });

    it('still treats the legacy selectedDocId "manifest" as the course', async () => {
      const preview = await previewWorkspace('collide', {
        manifest: manifestNamedItem,
        items: collidingItems,
        selectedDocId: 'manifest',
        locale: 'en',
      }, true, previewDeps());

      expect(preview.item).toBeNull();
      expect(preview.course).not.toBeNull();
    });

    it('prefers the ref when a legacy caller sends both', async () => {
      const preview = await previewWorkspace('collide', {
        manifest: manifestNamedItem,
        items: collidingItems,
        selectedRef: { kind: 'item', id: 'manifest' },
        selectedDocId: 'manifest',
        locale: 'en',
      }, true, previewDeps());

      expect(preview.item).toMatchObject({ id: 'manifest' });
    });

    it('requires one of the two, and rejects a malformed ref', async () => {
      await expect(previewWorkspace('collide', { manifest: manifestNamedItem, items: collidingItems, locale: 'en' }, true, previewDeps()))
        .rejects.toMatchObject({ status: 422, code: 'INVALID_WORKSPACE' });
      await expect(previewWorkspace('collide', {
        manifest: manifestNamedItem, items: collidingItems, locale: 'en',
        selectedRef: { kind: 'item' },
      }, true, previewDeps())).rejects.toMatchObject({ status: 422, code: 'INVALID_WORKSPACE' });
      await expect(previewWorkspace('collide', {
        manifest: manifestNamedItem, items: collidingItems, locale: 'en',
        selectedRef: { kind: 'course', id: 'manifest' },
      }, true, previewDeps())).rejects.toMatchObject({ status: 422, code: 'INVALID_WORKSPACE' });
    });
  });

  it('saves an item legitimately named "manifest" without touching the course document', async () => {
    const manifest = {
      schemaVersion: 1, kind: 'course', id: 'collide', title: 'Collide', summary: 'Name collision.',
      languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
      pathway: 'core-future-skills', learningOutcomes: ['Learn.'], access: { scope: 'global' },
      modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'manifest' }] }],
    };
    const snapshot = {
      id: 'draft-3', course_id: 'collide', manifest, items: { manifest: simpleLesson('manifest') },
      base_version_id: null, checklist: {}, updated_at: '2026-09-02T00:00:00Z',
    };
    const updated = { ...(simpleLesson('manifest') as Record<string, unknown>), estimatedMinutes: 4 };
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(snapshot)],
      studio_save_draft_workspace: [successful({ conflict: false, draft: snapshot })],
    });

    await expect(saveItem('collide', 'manifest', updated, actor, undefined, { client, resolver: new InMemoryResolver({}) })).resolves.toEqual(updated);
    expect(client.rpcCalls[1].args.manifest).toEqual(manifest);
    expect(client.rpcCalls[1].args.items).toEqual({ manifest: updated });
  });

  it('imports a complete inline course with its draft in one RPC', async () => {
    const parsed = parseWorkspace(FIXTURES['ai-foundations']).parsed;
    if (!parsed) throw new Error('Fixture must parse');
    const inline = inlineWorkspace(parsed);
    const splitItems = { 'what-is-ai': expect.objectContaining({ id: 'what-is-ai', kind: 'lesson' }) };
    const savedDraft = { id: 'draft-new', course_id: 'ai-foundations', manifest: FIXTURES['ai-foundations'].manifest, items: {}, checklist: {}, updated_at: '2026-09-02T00:00:00Z' };
    const client = new SupabaseStub({}, { studio_import_course: [successful({ conflict: false, draft: savedDraft })] });

    await expect(importNewCourse(JSON.stringify(inline), actor, engineDeps(client))).resolves.toMatchObject({ draft: { id: 'draft-new' } });
    expect(client.rpcCalls[0]).toMatchObject({ name: 'studio_import_course', args: { course_id: 'ai-foundations', items: splitItems } });
  });

  it('returns 404 when the course has no draft', async () => {
    useClient(new SupabaseStub({ course_drafts: [successful(null)] }));

    await expect(getDraft('missing-course')).rejects.toMatchObject({
      status: 404,
      code: 'DRAFT_NOT_FOUND',
    });
  });

  it('saves a manifest with the stored item documents in one guarded transaction', async () => {
    const manifest = { ...(FIXTURES['ai-foundations'].manifest as Record<string, unknown>), summary: 'Changed' };
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(draftSnapshot())],
      studio_save_draft_workspace: [successful({ conflict: false, draft: draftSnapshot(manifest) })],
    });

    await expect(saveManifest('ai-foundations', manifest, actor, undefined, engineDeps(client))).resolves.toEqual(manifest);
    // No stray write to course_drafts.manifest: the manifest and the item documents
    // move together, so storage can never hold a combination nothing validated.
    expect(client.queries).toEqual([]);
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot', 'studio_save_draft_workspace']);
    expect(client.rpcCalls[1].args).toMatchObject({
      manifest,
      items: FIXTURES['ai-foundations'].items,
      actor_id: actor.userId,
      expected_updated_at: '2026-09-02T00:00:00Z',
      set_base_version: false,
    });
  });

  it.each([null, ''])('uses the revision it just read when a legacy caller sends %j', async (token) => {
    const manifest = { ...(FIXTURES['ai-foundations'].manifest as Record<string, unknown>), summary: 'New draft edit' };
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(draftSnapshot(FIXTURES['ai-foundations'].manifest, FIXTURES['ai-foundations'].items, '2026-09-05T00:00:00Z'))],
      studio_save_draft_workspace: [successful({ conflict: false, draft: draftSnapshot(manifest) })],
    });

    await expect(saveManifest('ai-foundations', manifest, actor, token, engineDeps(client))).resolves.toEqual(manifest);
    // A caller without If-Match still gets compare-and-set, not a blind overwrite.
    expect(client.rpcCalls[1].args.expected_updated_at).toBe('2026-09-05T00:00:00Z');
  });

  it('rejects a manifest save when the expected draft revision is stale', async () => {
    const manifest = { ...(FIXTURES['ai-foundations'].manifest as Record<string, unknown>), summary: 'Local edit' };
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(draftSnapshot())],
      studio_save_draft_workspace: [successful({ conflict: true })],
    });

    await expect(saveManifest('ai-foundations', manifest, actor, '2026-09-01T00:00:00Z', engineDeps(client))).rejects.toMatchObject({
      status: 409,
      code: 'DRAFT_CONFLICT',
    });
    expect(client.rpcCalls[1].args.expected_updated_at).toBe('2026-09-01T00:00:00Z');
  });

  it('rejects a manifest that declares an item with no document, before writing anything', async () => {
    const manifest = structuredClone(FIXTURES['ai-foundations'].manifest) as { modules: { items: unknown[] }[] };
    manifest.modules[0].items.push({ type: 'lesson', id: 'ghost-lesson', title: 'Ghost' });
    const client = new SupabaseStub({}, { studio_get_draft_snapshot: [successful(draftSnapshot())] });

    await expect(saveManifest('ai-foundations', manifest, actor, undefined, engineDeps(client))).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_MANIFEST',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'E_MISSING_ITEM_DOCUMENT' })]),
    });
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot']);
  });

  it('rejects a structurally invalid manifest with engine diagnostics before writing', async () => {
    const manifest = structuredClone(FIXTURES['ai-foundations'].manifest) as Record<string, unknown>;
    delete manifest.learningOutcomes;
    const client = useClient(new SupabaseStub());

    await expect(saveManifest('ai-foundations', manifest, actor)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_MANIFEST',
      issues: expect.arrayContaining([expect.objectContaining({ path: ['manifest', 'learningOutcomes'], message: expect.any(String) })]),
    });
    expect(client.queries).toEqual([]);
  });

  it('saves an item as part of the whole workspace, in one guarded transaction', async () => {
    const document = { ...(FIXTURES['ai-foundations'].items['what-is-ai'] as Record<string, unknown>), estimatedMinutes: 9 };
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(draftSnapshot())],
      studio_save_draft_workspace: [successful({ conflict: false, draft: draftSnapshot() })],
    });

    await expect(saveItem('ai-foundations', 'what-is-ai', document, actor, undefined, engineDeps(client))).resolves.toEqual(document);
    expect(client.queries).toEqual([]);
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot', 'studio_save_draft_workspace']);
    expect(client.rpcCalls[1].args).toMatchObject({
      manifest: FIXTURES['ai-foundations'].manifest,
      items: { ...FIXTURES['ai-foundations'].items, 'what-is-ai': document },
      expected_updated_at: '2026-09-02T00:00:00Z',
      set_base_version: false,
    });
  });

  it.each([null, ''])('uses the revision it just read for an item save sent with %j', async (token) => {
    const document = FIXTURES['ai-foundations'].items['what-is-ai'];
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(draftSnapshot(FIXTURES['ai-foundations'].manifest, FIXTURES['ai-foundations'].items, '2026-09-06T00:00:00Z'))],
      studio_save_draft_workspace: [successful({ conflict: false, draft: draftSnapshot() })],
    });

    await expect(saveItem('ai-foundations', 'what-is-ai', document, actor, token, engineDeps(client))).resolves.toEqual(document);
    expect(client.rpcCalls[1].args.expected_updated_at).toBe('2026-09-06T00:00:00Z');
  });

  it('leaves content and revision untouched when the guarded item write conflicts', async () => {
    const document = FIXTURES['ai-foundations'].items['what-is-ai'];
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(draftSnapshot())],
      studio_save_draft_workspace: [successful({ conflict: true })],
    });

    await expect(saveItem('ai-foundations', 'what-is-ai', document, actor, '2026-09-02T00:00:00Z', engineDeps(client))).rejects.toMatchObject({
      status: 409,
      code: 'DRAFT_CONFLICT',
    });
    // One transaction, one outcome: nothing partially written, no revision bump.
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot', 'studio_save_draft_workspace']);
    expect(client.queries).toEqual([]);
  });

  it('rejects an item document the manifest does not declare, before writing anything', async () => {
    const document = { ...(structuredClone(FIXTURES['ai-foundations'].items['what-is-ai']) as Record<string, unknown>), id: 'stray-lesson' };
    const client = new SupabaseStub({}, { studio_get_draft_snapshot: [successful(draftSnapshot())] });

    await expect(saveItem('ai-foundations', 'stray-lesson', document, actor, undefined, engineDeps(client))).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_ITEM',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'E_ORPHAN_ITEM_DOCUMENT' })]),
    });
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot']);
  });

  it('rejects an item that fails its kind-specific document schema before writing', async () => {
    const document = { ...(structuredClone(FIXTURES['ai-foundations'].items['what-is-ai']) as Record<string, unknown>), blocks: 'not-an-array' };
    const client = useClient(new SupabaseStub());

    await expect(saveItem('ai-foundations', 'what-is-ai', document, actor)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_ITEM',
      issues: expect.arrayContaining([expect.objectContaining({ path: ['what-is-ai', 'blocks'], message: expect.any(String) })]),
    });
    expect(client.queries).toEqual([]);
  });

  it('removes an item stub and its document together, leaving a workspace that still validates', async () => {
    // Keeping the document row as an orphan left storage in a state a save could no
    // longer reproduce, so the stub and the document go in the same transaction.
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(twoItemSnapshot())],
      studio_save_draft_workspace: [successful({ conflict: false, draft: twoItemSnapshot('2026-09-03T00:00:00Z') })],
    });

    const updated = await deleteItem('two-items', 'drop', actor, { client, resolver: new InMemoryResolver({}) });

    expect(JSON.stringify(updated)).not.toContain('drop');
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot', 'studio_save_draft_workspace']);
    expect(Object.keys(client.rpcCalls[1].args.items as Record<string, unknown>)).toEqual(['keep']);
    expect(client.rpcCalls[1].args.expected_updated_at).toBe('2026-09-02T00:00:00Z');
  });

  it.each([
    ['a next_step target', 'ml-vs-rules', 'E_NEXT_STEP_TARGET_UNKNOWN'],
    ['the completion exam', 'exam-m1', 'E_COMPLETION_TARGET_UNKNOWN'],
  ])('refuses to remove an item that is still %s', async (_label, itemId, code) => {
    // Removing it would leave a dangling reference. The delete is refused rather than
    // persisted and discovered later at publication.
    const client = new SupabaseStub({}, { studio_get_draft_snapshot: [successful(draftSnapshot())] });

    await expect(deleteItem('ai-foundations', itemId, actor, engineDeps(client))).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_WORKSPACE',
      issues: expect.arrayContaining([expect.objectContaining({ code })]),
    });
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot']);
  });

  it('imports a single inline course through one guarded draft replacement', async () => {
    const inlineCourse = completeInlineMinimal();
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(minimalSnapshot('2026-09-04T00:00:00Z'))],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    });

    await importSingle('minimal', JSON.stringify(inlineCourse), actor, { client, resolver: minimalResolver() });

    // The unguarded replacement is gone: an import without If-Match still writes
    // against the revision it read.
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot', 'studio_replace_draft_if_current']);
    expect(client.rpcCalls[1].args).toMatchObject({ course_id: 'minimal', expected_updated_at: '2026-09-04T00:00:00Z' });
    expect(client.rpcCalls[1].args.items).toMatchObject({ hello: { kind: 'assignment', id: 'hello' } });
  });

  it('rejects a replacement import when the flushed draft revision is no longer current', async () => {
    const inlineCourse = completeInlineMinimal();
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(minimalSnapshot())],
      studio_replace_draft_if_current: [successful({ conflict: true })],
    });

    await expect(importSingle(
      'minimal',
      JSON.stringify(inlineCourse),
      actor,
      { client, resolver: minimalResolver() },
      '2026-09-02T00:00:00Z',
    )).rejects.toMatchObject({ status: 409, code: 'DRAFT_CONFLICT' });

    expect(client.rpcCalls[1]).toMatchObject({
      name: 'studio_replace_draft_if_current',
      args: expect.objectContaining({ course_id: 'minimal', expected_updated_at: '2026-09-02T00:00:00Z' }),
    });
  });

  it('rejects an import whose course id is not the route course, without writing', async () => {
    const foreign = { ...completeInlineMinimal(), id: 'somewhere-else' };
    const client = new SupabaseStub({}, { studio_get_draft_snapshot: [successful(minimalSnapshot())] });

    await expect(importSingle('minimal', JSON.stringify(foreign), actor, { client, resolver: minimalResolver() }))
      .rejects.toMatchObject({
        status: 422,
        code: 'INVALID_COURSE',
        issues: expect.arrayContaining([expect.objectContaining({ code: 'E_WORKSPACE_ID_MISMATCH' })]),
      });
    expect(rpcNames(client)).not.toContain('studio_replace_draft_if_current');
  });

  it.each([
    ['a bare { manifest, items } backup', false],
    ['a kinded workspace envelope', true],
  ])('imports %s losslessly, keeping standalone item metadata the inline export drops', async (_label, kinded) => {
    const parsed = parseWorkspace(FIXTURES.minimal).parsed;
    if (!parsed) throw new Error('Fixture must parse');
    // Standalone items carry their own $schema/languages, which the portable inline
    // course export cannot represent. The backup must bring them back untouched.
    const intro = { ...(FIXTURES.minimal.items.intro as Record<string, unknown>), languages: ['vi'], defaultLanguage: 'vi' };
    const snapshot = { manifest: parsed.manifest, items: { ...parsed.items, intro } };
    const text = JSON.stringify(kinded ? encodeWorkspaceEnvelope(snapshot) : snapshot);
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(minimalSnapshot())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    });

    const result = await importSingle('minimal', text, actor, { client, resolver: minimalResolver() });

    expect(result.items.intro).toMatchObject({ languages: ['vi'], defaultLanguage: 'vi' });
    const replace = client.rpcCalls.find((call) => call.name === 'studio_replace_draft_if_current')!;
    expect(replace.args.items).toMatchObject({ intro: { languages: ['vi'] } });
  });

  it.each([
    ['a standalone item document', () => JSON.stringify(FIXTURES.minimal.items.intro)],
    ['a local recovery record', () => JSON.stringify({ kind: 'vfuture.studio.recovery', version: 1, courseId: 'minimal', sources: { course: '{}' }, baseVersionId: null, baseUpdatedAt: null, modifiedAt: null })],
  ])('refuses %s on the course import path', async (_label, build) => {
    const client = new SupabaseStub({}, { studio_get_draft_snapshot: [successful(minimalSnapshot())] });

    await expect(importSingle('minimal', build(), actor, { client, resolver: minimalResolver() }))
      .rejects.toMatchObject({ status: 422, code: 'INVALID_COURSE' });
    expect(rpcNames(client)).not.toContain('studio_replace_draft_if_current');
  });

  it('creates a new course from a workspace backup without inheriting another course\'s base version', async () => {
    const parsed = parseWorkspace(FIXTURES.minimal).parsed;
    if (!parsed) throw new Error('Fixture must parse');
    const text = JSON.stringify(encodeWorkspaceEnvelope({ manifest: parsed.manifest, items: parsed.items, baseVersionId: '11111111-2222-4333-8444-555555555555' }));
    const savedDraft = { ...minimalSnapshot(), id: 'draft-new' };
    const client = new SupabaseStub({}, { studio_import_course: [successful({ conflict: false, draft: savedDraft })] });

    await expect(importNewCourse(text, actor, { client, resolver: minimalResolver() })).resolves.toMatchObject({ draft: { id: 'draft-new' } });
    expect(client.rpcCalls[0]).toMatchObject({ name: 'studio_import_course', args: { course_id: 'minimal', base_version_id: null } });
  });

  it('imports bundle documents, delegates questions/assets, and rewrites asset URLs', async () => {
    const zip = new JSZip();
    const course = { ...(structuredClone(FIXTURES.minimal.manifest) as Record<string, unknown>), cover: { url: 'asset:cover.png' } };
    zip.file('course.json', JSON.stringify(course));
    zip.file('items/intro.json', JSON.stringify(FIXTURES.minimal.items.intro));
    zip.file('questions/basics.json', JSON.stringify(questionBundle()));
    zip.file('assets/cover.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_cover' });
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(minimalSnapshot())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    });

    await importBundle('minimal', bytes, actor, { importQuestions, uploadMedia }, { client, resolver: minimalResolver(['asset_cover']) });

    expect(uploadMedia).toHaveBeenCalledWith('cover.png', expect.any(Uint8Array));
    expect(importQuestions).toHaveBeenCalledWith(expect.objectContaining({ kind: 'question_bundle', id: 'basics' }), actor);
    const replace = client.rpcCalls.find((call) => call.name === 'studio_replace_draft_if_current')!;
    expect(replace.args.manifest).toMatchObject({ cover: { assetId: 'asset_cover' } });
    expect(replace.args.items).toMatchObject({ intro: { kind: 'lesson', id: 'intro' }, hello: { kind: 'assignment', id: 'hello' } });
  });

  it('rejects an entry declaring more than 20 MB before any entry is decompressed', async () => {
    const courseEntry = fakeEntry('course.json', 100);
    const oversizedEntry = fakeEntry('assets/large.bin', 20 * 1024 * 1024 + 1);
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip([courseEntry, oversizedEntry]) as unknown as JSZip);

    await expect(importBundle('minimal', await validZipEnvelope(), actor)).rejects.toMatchObject({
      status: 413,
      code: 'BUNDLE_ENTRY_TOO_LARGE',
    });
    expect(courseEntry.async).not.toHaveBeenCalled();
    expect(oversizedEntry.async).not.toHaveBeenCalled();
  });

  it('rejects more than 2000 zip entries before any entry is decompressed', async () => {
    const entryAsync = vi.fn().mockRejectedValue(new Error('entry async must not run'));
    const entries = [fakeEntry('course.json', 100, entryAsync)];
    for (let index = 0; index < 2000; index += 1) entries.push(fakeEntry(`assets/file-${index}.bin`, 1, entryAsync));
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip(entries) as unknown as JSZip);

    await expect(importBundle('minimal', await validZipEnvelope(), actor)).rejects.toMatchObject({
      status: 413,
      code: 'BUNDLE_TOO_MANY_ENTRIES',
    });
    expect(entryAsync).not.toHaveBeenCalled();
  });

  it('rejects archives whose declared uncompressed total exceeds 100 MB', async () => {
    const entries = [fakeEntry('course.json', 100)];
    for (let index = 0; index < 6; index += 1) entries.push(fakeEntry(`assets/file-${index}.bin`, 20 * 1024 * 1024));
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip(entries) as unknown as JSZip);

    await expect(importBundle('minimal', await validZipEnvelope(), actor)).rejects.toMatchObject({
      status: 413,
      code: 'BUNDLE_UNCOMPRESSED_TOO_LARGE',
    });
    expect(entries.every((entry) => entry.async.mock.calls.length === 0)).toBe(true);
  });

  it('rejects unix symlink entries before decompression', async () => {
    const courseEntry = fakeEntry('course.json', 100);
    const symlink = { ...fakeEntry('assets/link', 4), dir: true, unixPermissions: 0o120777 };
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip([courseEntry, symlink]) as unknown as JSZip);

    await expect(importBundle('minimal', await validZipEnvelope(), actor)).rejects.toMatchObject({
      status: 400,
      code: 'BUNDLE_SYMLINK_FORBIDDEN',
    });
    expect(courseEntry.async).not.toHaveBeenCalled();
    expect(symlink.async).not.toHaveBeenCalled();
  });

  it.each([
    'assets/../../x',
    'assets//c:/x',
    'assets/bad\0name.png',
    `assets/${'a'.repeat(4096)}`,
  ])('rejects unsafe bundle path %s before decompression', async (name) => {
    const courseEntry = fakeEntry('course.json', 100);
    const unsafeEntry = fakeEntry(name, 1);
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip([courseEntry, unsafeEntry]) as unknown as JSZip);

    await expect(importBundle('minimal', await validZipEnvelope(), actor)).rejects.toMatchObject({
      status: 400,
      code: 'BUNDLE_PATH_INVALID',
    });
    expect(courseEntry.async).not.toHaveBeenCalled();
    expect(unsafeEntry.async).not.toHaveBeenCalled();
  });

  it('rejects a path JSZip sanitized when loading the central directory', async () => {
    const courseEntry = fakeEntry('course.json', 100);
    const sanitizedEntry = {
      ...fakeEntry('assets/x', 1),
      unsafeOriginalName: '../../assets/x',
    };
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(fakeZip([courseEntry, sanitizedEntry]) as unknown as JSZip);

    await expect(importBundle('minimal', await validZipEnvelope(), actor)).rejects.toMatchObject({
      status: 400,
      code: 'BUNDLE_PATH_INVALID',
    });
    expect(courseEntry.async).not.toHaveBeenCalled();
    expect(sanitizedEntry.async).not.toHaveBeenCalled();
  });

  it('rejects duplicate raw central-directory names before JSZip collapses them', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('assets/a.bin', new Uint8Array([1]));
    zip.file('assets/b.bin', new Uint8Array([2]));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    patchZipFilename(bytes, 'assets/b.bin', 'assets/a.bin');
    const loadZip = vi.spyOn(JSZip, 'loadAsync');
    useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor)).rejects.toMatchObject({
      status: 400,
      code: 'BUNDLE_DUPLICATE_ENTRY',
    });
    expect(loadZip).not.toHaveBeenCalled();
  });

  it.each(['assets/large.bin', 'course.json', 'items/large.json', 'questions/large.json'])('bounds tampered actual expansion of %s before persistence', async (name) => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file(name, new Uint8Array(20 * 1024 * 1024 + 1));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const length = view.getUint16(offset + 28, true);
      if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length)) === name) view.setUint32(offset + 24, 1, true);
    }
    const uploadMedia = vi.fn();
    const importQuestions = vi.fn();
    const preflightPersistence = vi.fn();
    const client = useClient(new SupabaseStub());
    await expect(importBundle('minimal', bytes, actor, { uploadMedia, importQuestions, preflightPersistence }))
      .rejects.toMatchObject({ status: 413, code: 'BUNDLE_ENTRY_TOO_LARGE' });
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(importQuestions).not.toHaveBeenCalled();
    expect(preflightPersistence).not.toHaveBeenCalled();
    expect(client.rpcCalls).toEqual([]);
  });

  it('validates question documents before invoking a persistence hook', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('questions/basics.json', JSON.stringify(questionBundle([])));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);

    await expect(importBundle('minimal', bytes, actor, { importQuestions })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_BUNDLE_QUESTION',
      issues: expect.arrayContaining([expect.objectContaining({ path: ['questions/basics.json', 'questions'], message: expect.any(String) })]),
    });
    expect(importQuestions).not.toHaveBeenCalled();
  });

  it('validates every archive document before invoking any persistence hook', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('items/invalid.json', JSON.stringify({
      ...(FIXTURES.minimal.items.intro as Record<string, unknown>),
      blocks: 'invalid',
    }));
    zip.file('questions/basics.json', JSON.stringify(questionBundle()));
    zip.file('assets/cover.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_cover' });

    await expect(importBundle('minimal', bytes, actor, { importQuestions, uploadMedia }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_BUNDLE_ITEM' });
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(importQuestions).not.toHaveBeenCalled();
  });

  it('rejects duplicate item document ids before hooks or draft replacement', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('items/first.json', JSON.stringify(FIXTURES.minimal.items.intro));
    zip.file('items/second.json', JSON.stringify(FIXTURES.minimal.items.intro));
    zip.file('questions/basics.json', JSON.stringify(questionBundle()));
    zip.file('assets/cover.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_cover' });
    const client = useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor, { importQuestions, uploadMedia }))
      .rejects.toMatchObject({ status: 409, code: 'DUPLICATE_BUNDLE_DOCUMENT' });
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(importQuestions).not.toHaveBeenCalled();
    expect(client.rpcCalls).toEqual([]);
  });

  it('rejects duplicate question ids across bundle files before bank persistence', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('questions/first.json', JSON.stringify(questionBundle()));
    zip.file('questions/second.json', JSON.stringify({ ...questionBundle(), id: 'more-questions' }));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor, { importQuestions }))
      .rejects.toMatchObject({ status: 409, code: 'DUPLICATE_BUNDLE_QUESTION' });
    expect(importQuestions).not.toHaveBeenCalled();
  });

  it('preflights every asset before the first upload hook is invoked', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('assets/valid.png', new Uint8Array([1, 2, 3]));
    zip.file('assets/script.svg', new Uint8Array([4, 5, 6]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_REAL' });
    const validateMedia = vi.fn(async (filename: string) => {
      if (filename.endsWith('.svg')) throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Unsupported media file');
    });
    const hooks = { validateMedia, uploadMedia } as BundleImportHooks;
    useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor, hooks))
      .rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA' });
    expect(validateMedia).toHaveBeenCalledTimes(2);
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it('checks media permission before the first asset persistence write', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('assets/cover.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const denial = new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const preflightPersistence = vi.fn().mockRejectedValue(denial);
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_REAL' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    const hooks = { preflightPersistence, uploadMedia, importQuestions } as BundleImportHooks;
    const client = useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor, hooks)).rejects.toBe(denial);

    expect(preflightPersistence).toHaveBeenCalledWith({ hasAssets: true, hasQuestions: false }, actor);
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(importQuestions).not.toHaveBeenCalled();
    expect(client.rpcCalls).toEqual([]);
  });

  it('checks bank permission before the first question persistence write', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('questions/basics.json', JSON.stringify(questionBundle()));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const denial = new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const preflightPersistence = vi.fn().mockRejectedValue(denial);
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_REAL' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    const hooks = { preflightPersistence, uploadMedia, importQuestions } as BundleImportHooks;
    const client = useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor, hooks)).rejects.toBe(denial);

    expect(preflightPersistence).toHaveBeenCalledWith({ hasAssets: false, hasQuestions: true }, actor);
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(importQuestions).not.toHaveBeenCalled();
    expect(client.rpcCalls).toEqual([]);
  });

  it('denies bank preflight for a mixed bundle before uploading its first asset', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('questions/basics.json', JSON.stringify(questionBundle()));
    zip.file('assets/cover.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const denial = new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const preflightPersistence = vi.fn(async (requirements: { hasAssets: boolean; hasQuestions: boolean }) => {
      if (requirements.hasQuestions) throw denial;
    });
    const uploadMedia = vi.fn().mockResolvedValue({ assetId: 'asset_REAL' });
    const importQuestions = vi.fn().mockResolvedValue(undefined);
    const hooks = { preflightPersistence, uploadMedia, importQuestions } as BundleImportHooks;
    const client = useClient(new SupabaseStub({}, { studio_replace_draft: [successful({ draft_id: 'draft-1' })] }));

    await expect(importBundle('minimal', bytes, actor, hooks)).rejects.toBe(denial);

    expect(preflightPersistence).toHaveBeenCalledWith({ hasAssets: true, hasQuestions: true }, actor);
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(importQuestions).not.toHaveBeenCalled();
    expect(client.rpcCalls).toEqual([]);
  });

  it('caps recursive asset rewriting at 64 levels with a client diagnostic', () => {
    let document: unknown = 'leaf';
    for (let depth = 0; depth < 66; depth += 1) document = { nested: document };

    expect(() => rewriteAssetReferences(document, new Map(), 'manifest')).toThrowError(expect.objectContaining({
      status: 400,
      code: 'BUNDLE_NESTING_TOO_DEEP',
      issues: expect.arrayContaining([expect.objectContaining({
        path: expect.arrayContaining(['manifest']),
        message: expect.stringContaining('Limit exceeded'),
      })]),
    }));
  });

  it('reports skipped questions and stubbed assets when default import hooks are used', async () => {
    const zip = new JSZip();
    const course = { ...(structuredClone(FIXTURES.minimal.manifest) as Record<string, unknown>), cover: { url: 'asset:cover.png' } };
    zip.file('course.json', JSON.stringify(course));
    zip.file('items/intro.json', JSON.stringify(FIXTURES.minimal.items.intro));
    zip.file('questions/basics.json', JSON.stringify(questionBundle()));
    zip.file('assets/cover.png', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(minimalSnapshot())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    });

    // The stub asset id the default hook invents is what the persisted documents
    // reference, so validation has to run against those ids, not the original names.
    const imported = await importBundle('minimal', bytes, actor, {}, { client, resolver: minimalResolver([stubAssetIdOf('cover.png')]) });

    expect(imported.warnings).toEqual({
      skippedQuestions: ['questions/basics.json'],
      stubbedAssets: ['cover.png'],
    });
    expect(rpcNames(client)).toEqual(['studio_get_draft_snapshot', 'studio_replace_draft_if_current']);
  });

  it('generates distinct bounded stub asset ids from the complete asset path', async () => {
    const zip = new JSZip();
    zip.file('course.json', JSON.stringify(FIXTURES.minimal.manifest));
    zip.file('items/intro.json', JSON.stringify(FIXTURES.minimal.items.intro));
    zip.file('assets/a-b.png', new Uint8Array([1]));
    zip.file('assets/a/b.png', new Uint8Array([2]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const client = new SupabaseStub({}, {
      studio_get_draft_snapshot: [successful(minimalSnapshot())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    });

    const imported = await importBundle('minimal', bytes, actor, {}, { client, resolver: minimalResolver() });

    expect(imported.assets['a-b.png']).not.toBe(imported.assets['a/b.png']);
    expect(imported.assets['a-b.png']).toMatch(/^asset_stub_[a-f0-9]+$/);
    expect(imported.assets['a-b.png'].length).toBeLessThanOrEqual(80);
    expect(imported.assets['a/b.png'].length).toBeLessThanOrEqual(80);
  });

  it('returns validation diagnostics with source ranges for each stored document', async () => {
    const missingOneItem = Object.fromEntries(Object.entries(FIXTURES['ai-foundations'].items).filter(([id]) => id !== 'what-is-ai'));
    useClient(new SupabaseStub({ course_drafts: [successful(draftRow())], course_draft_items: [successful(itemRows(missingOneItem))] }));

    const report = await validateDraft('ai-foundations', { publish: false }, { resolver: fixtureResolver });

    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'E_MISSING_ITEM_DOCUMENT', docId: 'manifest', range: expect.any(Object) })]));
  });

  it('previews one locale from the same compiled draft used for publishing', async () => {
    useClient(new SupabaseStub({ course_drafts: [successful(draftRow())], course_draft_items: [successful(itemRows())] }));

    const item = await previewItem('ai-foundations', 'what-is-ai', 'en', { resolver: fixtureResolver });

    expect(item).toMatchObject({ id: 'what-is-ai', kind: 'lesson', renders: { en: { kind: 'lesson', id: 'what-is-ai' } } });
    expect(item).not.toHaveProperty('renders.vi');
  });
});
