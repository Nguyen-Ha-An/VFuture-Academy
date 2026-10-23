import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { stableStringify } from '@/content-engine/compile/checksum';
import { decodeItemImport } from '@/features/studio/content-transfer';
import type { StudioDatabase } from '@/features/studio/drafts';
import { prepareImportPackage } from '@/features/studio-mcp/import-package';
import { MAX_ENVELOPE_BYTES } from '@/content-engine/validate/parse';

vi.mock('server-only', () => ({}));
const { serviceMock } = vi.hoisted(() => ({ serviceMock: vi.fn(() => { throw new Error('service client fallback'); }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: serviceMock }));

import { reviewPending, simulateStudioImport, summarizeItemChanges } from '@/features/studio-mcp/validation/simulate-import';

const original = {
  schemaVersion: 1, kind: 'lesson', id: 'intro', title: 'Welcome',
  objectives: ['Learn.'], blocks: [{ id: 'p1', type: 'paragraph', content: [{ text: 'Hello.' }] }],
};
const manifest = {
  schemaVersion: 1, kind: 'course', id: 'course-a', title: 'Course A', summary: 'A course.',
  languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
  pathway: 'core-future-skills', learningOutcomes: ['Learn.'], access: { scope: 'global' },
  modules: [{ id: 'm1', title: 'First module', items: [{ id: 'intro', type: 'lesson', title: 'Welcome' }] }],
};
const draft = {
  id: 'draft-a', courseId: 'course-a', manifest, items: { intro: original },
  baseVersionId: null, checklist: {}, updatedAt: '2026-09-26T00:00:00Z', revision: 'revision-a',
};
const hash = (item: unknown) => `sha256:${createHash('sha256').update(stableStringify(item)).digest('hex')}`;

function draftWithBulkLessons(blockCount: number) {
  const ids = ['bulk-a', 'bulk-b', 'bulk-c'];
  const bulkItems = Object.fromEntries(ids.map(id => [id, {
    schemaVersion: 1, kind: 'lesson', id, title: id,
    blocks: Array.from({ length: blockCount }, (_, index) => ({
      id: `${id}-paragraph-${index}`, type: 'paragraph', content: [{ text: 'A'.repeat(4_500) }],
    })),
  }]));
  return {
    ...draft,
    manifest: {
      ...manifest,
      modules: [{ ...manifest.modules[0], items: [
        ...manifest.modules[0].items,
        ...ids.map(id => ({ id, type: 'lesson', title: id })),
      ] }],
    },
    items: { ...draft.items, ...bulkItems },
  };
}

type ReviewRow = { id: string; content_type: string; content_id: string; status: string };
class PendingQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<[string, unknown]> = [];
  private maximum = Number.POSITIVE_INFINITY;
  constructor(private rows: ReviewRow[], private calls: string[]) {}
  select(columns: string) { this.calls.push(`columns:${columns}`); return this; }
  eq(column: string, value: unknown) { this.calls.push(`eq:${column}:${value}`); this.filters.push([column, value]); return this; }
  limit(value: number) { this.calls.push(`limit:${value}`); this.maximum = value; return this; }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    fulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.rows.filter(row => this.filters.every(([column, value]) => (row as unknown as Record<string, unknown>)[column] === value))
      .slice(0, this.maximum).map(row => ({ id: row.id }));
    return Promise.resolve({ data, error: null }).then(fulfilled, rejected);
  }
}

function deps(pending = false, rows: ReviewRow[] = pending ? [{ id: 'review-1', content_type: 'course', content_id: 'course-a', status: 'pending' }] : []) {
  const calls: string[] = [];
  const client = {
    from(table: string) { calls.push(`select:${table}`); return new PendingQuery(rows, calls); },
    rpc(name: string) { calls.push(`rpc:${name}`); throw new Error(`unexpected RPC ${name}`); },
  };
  return { client: client as unknown as StudioDatabase, calls };
}

describe('simulateStudioImport', () => {
  it('fails closed when the pending-review query has no usable result', async () => {
    const malformed = { from: () => ({
      select() { return this; }, eq() { return this; }, limit() { return this; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: null, error: null })); },
    }) } as unknown as StudioDatabase;
    await expect(reviewPending(malformed, 'course-a')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('uses the same content type, id and pending status predicate as the Studio guard', async () => {
    const { client, calls } = deps(false, [
      { id: 'other-course', content_type: 'course', content_id: 'other', status: 'pending' },
      { id: 'approved-course', content_type: 'course', content_id: 'course-a', status: 'approved' },
      { id: 'pending-project', content_type: 'project', content_id: 'course-a', status: 'pending' },
    ]);
    expect(await reviewPending(client, 'course-a')).toBe(false);
    expect(calls).toEqual([
      'select:cms_review_requests', 'columns:id',
      'eq:content_type:course', 'eq:content_id:course-a', 'eq:status:pending', 'limit:1',
    ]);
  });

  it('runs the same strict item decoder and Studio workspace save path without writing', async () => {
    const { client, calls } = deps();
    const result = await simulateStudioImport({
      draft, courseId: 'course-a', itemId: 'intro', baseItemHash: hash(original),
      edits: [{ op: 'replace', path: '/blocks/0/content/0/text', value: 'Updated.' }],
      client,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.document).toMatchObject({ id: 'intro', kind: 'lesson' });
    expect(result.importText).toBe(JSON.stringify(result.document, null, 2));
    expect(decodeItemImport(result.importText).ok).toBe(true);
    expect(result.proposedItemHash).toBe(hash(result.document));
    expect(result.moduleId).toBe('m1');
    expect(calls).toEqual([
      'select:cms_review_requests', 'columns:id',
      'eq:content_type:course', 'eq:content_id:course-a', 'eq:status:pending', 'limit:1',
    ]);
    expect(serviceMock).not.toHaveBeenCalled();
  });

  it('refuses a stale base before evaluating edits', async () => {
    const { client } = deps();
    await expect(simulateStudioImport({
      draft, courseId: 'course-a', itemId: 'intro', baseItemHash: hash({ changed: true }),
      edits: [{ op: 'replace', path: '/title', value: 'Wrong base' }], client,
    })).rejects.toMatchObject({ code: 'BASE_ITEM_CHANGED' });
  });

  it('reports a pending review without calling a write RPC', async () => {
    const { client, calls } = deps(true);
    const result = await simulateStudioImport({
      draft, courseId: 'course-a', itemId: 'intro', baseItemHash: hash(original),
      edits: [{ op: 'replace', path: '/blocks/0/content/0/text', value: 'Updated.' }], client,
    });
    expect(result.reviewPending).toBe(true);
    expect(result.warnings.some((issue) => issue.code === 'REVIEW_PENDING')).toBe(true);
    expect(calls).toEqual([
      'select:cms_review_requests', 'columns:id',
      'eq:content_type:course', 'eq:content_id:course-a', 'eq:status:pending', 'limit:1',
    ]);
  });

  it('classifies a malformed stored manifest as an unsaveable base draft for preparation', async () => {
    const { client } = deps();
    const malformedDraft = { ...draft, manifest: { ...manifest, summary: undefined } };
    const result = await simulateStudioImport({
      draft: malformedDraft, courseId: 'course-a', itemId: 'intro', baseItemHash: hash(original),
      edits: [{ op: 'replace', path: '/blocks/0/content/0/text', value: 'Updated.' }], client,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BASE_DRAFT_UNSAVEABLE', layer: 'workspace' }),
    ]));
    expect(() => prepareImportPackage({
      simulation: result, courseId: 'course-a', origin: 'https://academy.example.test', ownerScopeKey: 'central',
    })).toThrowError(expect.objectContaining({ code: 'BASE_DRAFT_UNSAVEABLE' }));
  });

  it('does not echo an invalid oversized id through the change summary', async () => {
    const { client } = deps();
    const hugeId = 'a'.repeat(800_000);
    const result = await simulateStudioImport({
      draft, courseId: 'course-a', itemId: 'intro', baseItemHash: hash(original),
      document: { ...original, id: hugeId }, client,
    });
    expect(result.valid).toBe(false);
    expect(result.changeSummary.addedIds.length).toBe(0);
    expect(result.changeSummary.removedIds.length).toBe(0);
    expect(result.changeSummary.changedIds.length).toBe(0);
    expect(JSON.stringify(result.changeSummary).length).toBeLessThan(1_000);
  });

  it('caps summaries of many valid ids and marks the summary as truncated', () => {
    const proposed = { id: 'intro', blocks: Array.from({ length: 150 }, (_, index) => ({ id: `block-${index}`, text: 'x' })) };
    const summary = summarizeItemChanges({ id: 'intro', blocks: [] }, proposed);
    expect(summary.addedIds.length + summary.removedIds.length + summary.changedIds.length).toBeLessThanOrEqual(100);
    expect(summary.truncated).toBe(true);
  });

  it('returns aggregated unchanged-legacy paths and count without content text', async () => {
    const { client } = deps();
    const legacy = { ...original, blocks: Array.from({ length: 25 }, () => ({
      type: 'paragraph', content: [{ text: 'PRIVATE_LEGACY_BODY' }],
    })) };
    const result = await simulateStudioImport({
      draft: { ...draft, items: { intro: legacy } },
      courseId: 'course-a', itemId: 'intro', baseItemHash: hash(legacy),
      edits: [{ op: 'replace', path: '/title', value: 'Revised title' }], client,
    });
    const warning = result.warnings.find(issue => issue.code === 'W_PROFILE_LEGACY_UNCHANGED');
    expect(warning?.meta?.count).toBeGreaterThanOrEqual(25);
    expect(warning?.meta?.paths).toHaveLength(20);
    expect(warning?.meta?.paths.every(path => path.startsWith('/blocks/'))).toBe(true);
    expect(JSON.stringify(warning)).not.toContain('PRIVATE_LEGACY_BODY');
  });

  it('enforces the 2 MiB limit on the actual Studio workspace payload', async () => {
    const { client } = deps();
    const proposal = { edits: [{ op: 'replace' as const, path: '/blocks/0/content/0/text', value: 'Updated.' }] };
    const under = await simulateStudioImport({
      draft: draftWithBulkLessons(145), courseId: 'course-a', itemId: 'intro',
      baseItemHash: hash(original), ...proposal, client,
    });
    expect(under.workspaceBytes).toBeLessThanOrEqual(MAX_ENVELOPE_BYTES);
    expect(under.errors.some(issue => issue.code === 'WORKSPACE_TOO_LARGE')).toBe(false);

    const over = await simulateStudioImport({
      draft: draftWithBulkLessons(160), courseId: 'course-a', itemId: 'intro',
      baseItemHash: hash(original), ...proposal, client,
    });
    expect(over.workspaceBytes).toBeGreaterThan(MAX_ENVELOPE_BYTES);
    expect(over.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WORKSPACE_TOO_LARGE', layer: 'workspace' })]));
    expect(() => prepareImportPackage({
      simulation: over, courseId: 'course-a', origin: 'https://academy.example.test', ownerScopeKey: 'central',
    })).toThrowError(expect.objectContaining({ code: 'WORKSPACE_TOO_LARGE' }));
  });

  it('rejects an attempt to change the item kind through a whole document', async () => {
    const { client } = deps();
    const assignment = {
      schemaVersion: 1, kind: 'assignment', id: 'intro', title: 'Welcome',
      instructions: { blocks: [{ type: 'paragraph', content: [{ text: 'Answer.' }] }] },
      submission: { accepts: ['text'] },
    };
    await expect(simulateStudioImport({
      draft, courseId: 'course-a', itemId: 'intro', baseItemHash: hash(original),
      document: assignment, client,
    })).rejects.toMatchObject({ code: 'IMMUTABLE_KIND' });
  });
});
