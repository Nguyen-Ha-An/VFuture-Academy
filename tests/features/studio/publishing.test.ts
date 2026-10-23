import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compileCourse } from '@/content-engine/compile';
import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';

const { auditMock, serviceMock } = vi.hoisted(() => ({ auditMock: vi.fn(), serviceMock: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: serviceMock }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import {
  exportVersion,
  importBundle,
  listVersions,
  prepareCoursePublication,
  publish,
  PublishInputSchema,
  restoreAsDraft,
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

const successful = (data: unknown): Result => ({ data, error: null });
const actor = { userId: '00000000-0000-4000-8000-000000000001', roles: [{ role: 'editor' as const, branchId: null }] };
const checklist = {
  outcomesReviewed: true,
  answerKeysVerified: true,
  accessibilityReviewed: true,
  ageAppropriate: true,
  linksValid: true,
  warningsAcknowledged: true,
} as const;
const draftRow = (manifest: unknown = FIXTURES['ai-foundations'].manifest) => ({
  id: 'draft-1', course_id: 'ai-foundations', manifest, base_version_id: null, checklist: {}, updated_at: '2026-09-02T00:00:00Z',
});
const itemRows = (items: Record<string, unknown> = FIXTURES['ai-foundations'].items) => Object.entries(items).map(([item_id, document]) => ({
  draft_id: 'draft-1', item_id, kind: (document as { kind: string }).kind, document,
}));
/** The one-shot draft snapshot a guarded replacement reads its precondition from. */
const draftSnapshotRow = (updatedAt = '2026-09-02T00:00:00Z') => ({
  id: 'draft-1', course_id: 'ai-foundations', manifest: FIXTURES['ai-foundations'].manifest,
  items: FIXTURES['ai-foundations'].items, base_version_id: null, checklist: {}, updated_at: updatedAt,
});
const versionRow = (checksum: string, version = 1) => ({
  id: `version-${version}`, course_id: 'ai-foundations', version, manifest: FIXTURES['ai-foundations'].manifest,
  checksum, summary: {}, published_by: actor.userId, published_at: '2026-09-02T00:00:00Z', notes: null,
});
const versionItemRows = () => Object.entries(FIXTURES['ai-foundations'].items).map(([item_id, source]) => ({
  version_id: 'version-1', item_id, kind: (source as { kind: string }).kind, source,
}));

function useClient(client: SupabaseStub) {
  serviceMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  auditMock.mockReset().mockResolvedValue(undefined);
  serviceMock.mockReset();
});

describe('studio publishing and versions', () => {
  it('rejects every publish checklist unless all required confirmations are true', () => {
    const keys = Object.keys(checklist) as Array<keyof typeof checklist>;

    for (const key of keys) {
      expect(PublishInputSchema.safeParse({ checklist: { ...checklist, [key]: false } }).success, key).toBe(false);
    }
  });

  it('refuses to publish when workspace validation has errors', async () => {
    const missingItem = Object.fromEntries(Object.entries(FIXTURES['ai-foundations'].items).filter(([id]) => id !== 'what-is-ai'));
    const client = useClient(new SupabaseStub({ course_drafts: [successful(draftRow())], course_draft_items: [successful(itemRows(missingItem))] }));

    const result = publish('ai-foundations', { checklist, notes: null }, actor, { resolver: fixtureResolver });

    await expect(result).rejects.toMatchObject({ status: 422, code: 'COURSE_INVALID' });
    expect(client.rpcCalls).toEqual([]);
  });

  it('returns the next immutable version allocated by the atomic publisher', async () => {
    const client = useClient(new SupabaseStub({
      course_drafts: [successful(draftRow()), successful(draftRow())],
      course_draft_items: [successful(itemRows()), successful(itemRows())],
    }, {
      studio_publish_version_guarded: [successful({ id: 'version-1', version: 1, checksum: 'checksum-1' }), successful({ id: 'version-2', version: 2, checksum: 'checksum-2' })],
    }));

    const first = await publish('ai-foundations', { checklist, notes: 'First' }, actor, { resolver: fixtureResolver });
    const second = await publish('ai-foundations', { checklist, notes: 'Second' }, actor, { resolver: fixtureResolver });

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(client.rpcCalls.map(({ name }) => name)).toEqual(['studio_publish_version_guarded', 'studio_publish_version_guarded']);
    expect(client.rpcCalls[1].args.audit_row).toEqual({
      actor_id: actor.userId,
      action: 'course.publish',
      target_type: 'course',
      target_id: 'ai-foundations',
      before: null,
      after: { checksum: expect.any(String) },
    });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('prepares and compiles a reviewed course without opening a write transaction', async () => {
    const client = useClient(new SupabaseStub({
      course_drafts: [successful(draftRow())],
      course_draft_items: [successful(itemRows())],
    }));

    const prepared = await prepareCoursePublication(
      'ai-foundations',
      { checklist, notes: 'Atomic approval' },
      { resolver: fixtureResolver },
      '2026-09-02T00:00:00Z',
    );

    expect(prepared).toMatchObject({
      courseId: 'ai-foundations',
      expectedUpdatedAt: '2026-09-02T00:00:00Z',
      checklist,
      notes: 'Atomic approval',
      checksum: expect.any(String),
    });
    expect(client.rpcCalls).toEqual([]);
  });

  it('passes declared skills to the guarded publish transaction', async () => {
    const client = useClient(new SupabaseStub({
      course_drafts: [successful(draftRow())],
      course_draft_items: [successful(itemRows())],
    }, {
      studio_publish_version_guarded: [successful({ id: 'version-1', version: 1, checksum: 'checksum-1' })],
    }));

    await publish('ai-foundations', { checklist }, actor, { resolver: fixtureResolver });

    expect(client.rpcCalls.at(-1)?.args.skill_declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ai-literacy' }),
    ]));
    expect(client.rpcCalls.at(-1)?.args.skill_category).toBe('ai');
    expect(client.queries.some(({ table }) => table === 'skills')).toBe(false);
    expect(client.rpcCalls.at(-1)?.name).toBe('studio_publish_version_guarded');
  });

  it('inserts undeclared question and assignment skills before publishing so evidence foreign keys exist', async () => {
    const items = structuredClone(FIXTURES['ai-foundations'].items);
    const exam = items['exam-m1'] as { sections: Array<{ questions: Array<Record<string, unknown>> }> };
    exam.sections[0].questions[0].skills = ['undeclared-question-skill'];
    const assignment = items['final-product'] as { skills?: string[] };
    assignment.skills = ['problem-framing', 'undeclared-assignment-skill'];
    const client = useClient(new SupabaseStub({
      course_drafts: [successful(draftRow())],
      course_draft_items: [successful(itemRows(items))],
    }, {
      studio_publish_version_guarded: [successful({ id: 'version-1', version: 1, checksum: 'checksum-1' })],
    }));

    await publish('ai-foundations', { checklist }, actor, { resolver: fixtureResolver });

    expect(client.rpcCalls.at(-1)?.args.skill_declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'undeclared-question-skill', name: 'undeclared-question-skill' }),
      expect.objectContaining({ id: 'undeclared-assignment-skill', name: 'undeclared-assignment-skill' }),
    ]));
    expect(client.queries.some(({ table }) => table === 'skills')).toBe(false);
  });

  it('leaves all skill writes to the transaction when a publish revision conflicts', async () => {
    const client = useClient(new SupabaseStub({
      course_drafts: [successful(draftRow())],
      course_draft_items: [successful(itemRows())],
    }, {
      studio_publish_version_guarded: [successful({ conflict: true })],
    }));

    await expect(publish('ai-foundations', { checklist }, actor, { resolver: fixtureResolver }, 'stale-revision'))
      .rejects.toMatchObject({ status: 409, code: 'DRAFT_CONFLICT' });
    expect(client.queries.some(({ table }) => table === 'skills')).toBe(false);
  });

  it('does not run a fallible audit statement after a committed publish', async () => {
    auditMock.mockRejectedValue(new Error('audit unavailable'));
    useClient(new SupabaseStub({
      course_drafts: [successful(draftRow())],
      course_draft_items: [successful(itemRows())],
    }, {
      studio_publish_version_guarded: [successful({ id: 'version-1', version: 1, checksum: 'checksum-1' })],
    }));

    await expect(publish('ai-foundations', { checklist }, actor, { resolver: fixtureResolver })).resolves.toMatchObject({ version: 1 });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('lists immutable course versions newest first', async () => {
    const rows = [{ version: 2 }, { version: 1 }];
    const client = useClient(new SupabaseStub({ course_versions: [successful(rows)] }));

    await expect(listVersions('ai-foundations')).resolves.toEqual(rows);
    expect(client.queries[0].operations).toContainEqual(['order', 'version', { ascending: false }]);
  });

  it('restores a version manifest and source items as a new active draft', async () => {
    const client = useClient(new SupabaseStub({
      course_versions: [successful(versionRow('version-checksum'))],
      course_version_items: [successful(versionItemRows())],
    }, {
      studio_get_draft_snapshot: [successful(draftSnapshotRow())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    }));

    const restored = await restoreAsDraft('ai-foundations', 1, actor);

    expect(restored).toMatchObject({ baseVersionId: 'version-1', version: 1 });
    // A restore is a replacement like any other: it writes against the revision it
    // read, so a concurrent edit is a conflict instead of a silent overwrite.
    expect(client.rpcCalls.map((call) => call.name)).toEqual(['studio_get_draft_snapshot', 'studio_replace_draft_if_current']);
    expect(client.rpcCalls[1].args).toEqual({
      course_id: 'ai-foundations',
      manifest: FIXTURES['ai-foundations'].manifest,
      items: FIXTURES['ai-foundations'].items,
      base_version_id: 'version-1',
      expected_updated_at: '2026-09-02T00:00:00Z',
    });
    expect(auditMock).toHaveBeenCalledWith(actor, 'course.restore', { type: 'course', id: 'ai-foundations' }, null, { version: 1, checksum: 'version-checksum' });
  });

  it('returns a restored draft when its post-commit audit fails and logs a correlation id', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auditMock.mockRejectedValue(new Error('audit unavailable'));
    useClient(new SupabaseStub({
      course_versions: [successful(versionRow('version-checksum'))],
      course_version_items: [successful(versionItemRows())],
      course_drafts: [successful({ id: 'draft-1' })],
    }, {
      studio_get_draft_snapshot: [successful(draftSnapshotRow())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    }));

    try {
      await expect(restoreAsDraft('ai-foundations', 1, actor)).resolves.toMatchObject({
        draftId: 'draft-1',
        baseVersionId: 'version-1',
      });
      expect(errorLog).toHaveBeenCalledWith('Studio audit write failed after commit', expect.objectContaining({
        action: 'course.restore',
        correlationId: expect.any(String),
        courseId: 'ai-foundations',
      }));
    } finally {
      errorLog.mockRestore();
    }
  });

  it('exports the documented bundle layout', async () => {
    useClient(new SupabaseStub({
      course_versions: [successful(versionRow('version-checksum'))],
      course_version_items: [successful(versionItemRows())],
    }));

    const exported = await exportVersion('ai-foundations', 1, 'bundle');
    const zip = await JSZip.loadAsync(exported.body as Uint8Array);

    expect(exported).toMatchObject({ format: 'bundle', checksum: 'version-checksum', contentType: 'application/zip' });
    expect(Object.keys(zip.files).sort()).toEqual([
      'course.json', 'items/', 'items/exam-m1.json', 'items/final-product.json', 'items/ml-vs-rules.json', 'items/what-is-ai.json',
    ]);
  });

  it('exports a single course document with item bodies re-inlined', async () => {
    useClient(new SupabaseStub({
      course_versions: [successful(versionRow('version-checksum'))],
      course_version_items: [successful(versionItemRows())],
    }));

    const exported = await exportVersion('ai-foundations', 1, 'single');
    const course = JSON.parse(exported.body as string) as { modules: Array<{ items: Array<Record<string, unknown>> }> };
    const whatIsAi = course.modules.flatMap((moduleRow) => moduleRow.items).find((item) => item.id === 'what-is-ai');

    expect(exported).toMatchObject({ format: 'single', contentType: 'application/json; charset=utf-8', filename: 'ai-foundations-v1.json' });
    expect(whatIsAi).toMatchObject({ type: 'lesson', id: 'what-is-ai', blocks: expect.any(Array) });
  });

  it('strips unsafe characters from exported attachment filenames', async () => {
    useClient(new SupabaseStub({
      course_versions: [successful(versionRow('version-checksum'))],
      course_version_items: [successful(versionItemRows())],
    }));

    const exported = await exportVersion('unsafe/course\r\n"name', 1, 'single');

    expect(exported.filename).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(exported.filename).not.toMatch(/[\/\r\n"]|unsafe\/course/);
  });

  it('round-trips a bundle export through import without changing its compiled checksum', async () => {
    const compiled = await compileCourse(FIXTURES['ai-foundations'], fixtureResolver, { publish: true });
    if (!compiled.compiled) throw new Error('Fixture must compile');
    const client = useClient(new SupabaseStub({
      course_versions: [successful(versionRow(compiled.compiled.checksum))],
      course_version_items: [successful(versionItemRows())],
    }, {
      studio_get_draft_snapshot: [successful(draftSnapshotRow())],
      studio_replace_draft_if_current: [successful({ draft_id: 'draft-1' })],
    }));

    const exported = await exportVersion('ai-foundations', 1, 'bundle');
    await importBundle('ai-foundations', exported.body as Uint8Array, actor, {}, { client, resolver: fixtureResolver });
    const replacement = client.rpcCalls.find((call) => call.name === 'studio_replace_draft_if_current')!.args;
    const roundTrip = await compileCourse({ manifest: replacement.manifest, items: replacement.items as Record<string, unknown> }, fixtureResolver, { publish: true });

    expect(roundTrip.compiled?.checksum).toBe(exported.checksum);
  });
});
