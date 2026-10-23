import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { stableStringify } from '@/content-engine/compile/checksum';

vi.mock('server-only', () => ({}));
const { serviceMock } = vi.hoisted(() => ({ serviceMock: vi.fn(() => { throw new Error('service fallback'); }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: serviceMock }));

import { wrapReadOnlyDatabase } from '@/features/studio-mcp/db/read-only-database';
import { registerValidateItemTool } from '@/features/studio-mcp/tools/validate-item';
import { registerPrepareImportTool } from '@/features/studio-mcp/tools/prepare-import';
import { registerVerifyImportTool } from '@/features/studio-mcp/tools/verify-import';

const item = {
  schemaVersion: 1, kind: 'lesson', id: 'intro', title: 'Welcome', objectives: ['Learn.'],
  blocks: [{ id: 'paragraph-1', type: 'paragraph', content: [{ text: 'Hello.' }] }],
};
const manifest = {
  schemaVersion: 1, kind: 'course', id: 'course-a', title: 'Course A', summary: 'A course.',
  languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
  pathway: 'core-future-skills', learningOutcomes: ['Learn.'], access: { scope: 'global' },
  modules: [{ id: 'm1', title: 'First module', items: [{ id: 'intro', type: 'lesson', title: 'Welcome' }] }],
};
const hash = (value: unknown) => `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;

type RawResult = { data: unknown; error: null };
class Query implements PromiseLike<RawResult> {
  constructor(private readonly result: RawResult) {}
  select() { return this; }
  eq() { return this; }
  limit() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  then<TResult1 = RawResult, TResult2 = never>(
    fulfilled?: ((value: RawResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.result).then(fulfilled, rejected); }
}

type ToolOutput = { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Studio import tools through the live wrapper', () => {
  it('validates, prepares, and verifies without content writes', async () => {
    vi.stubEnv('STUDIO_MCP_PREPARATION_PROOF_SECRET', 'ab'.repeat(32));
    const logged = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let storedItem: unknown = item;
    const operations: string[] = [];
    const raw = {
      from(table: string) {
        operations.push(`select:${table}`);
        return new Query({ data: table === 'courses' ? { ownership_kind: 'central', owner_branch_id: null } : [], error: null });
      },
      async rpc(name: string) {
        operations.push(`rpc:${name}`);
        if (name === 'authorization_actor') return { data: {
          accountStatus: 'active', memberships: [], assignments: [{
            roleDefinitionId: 'central_editor', scope: { kind: 'central' },
            permissions: ['course.read', 'course.edit', 'content.read', 'content.edit'],
          }],
        }, error: null };
        if (name === 'rate_limit' || name === 'cms_assert_content_access') return { data: true, error: null };
        if (name === 'studio_get_draft_snapshot') return { data: {
          id: 'draft-a', course_id: 'course-a', manifest, items: { intro: storedItem },
          base_version_id: null, checklist: {}, updated_at: '2026-09-26T00:00:00Z',
        }, error: null };
        throw new Error(`unexpected RPC ${name}`);
      },
      auth: { admin: { oauth: { getClient: async () => ({ data: null, error: null }) } } },
    };
    const callbacks = new Map<string, (args: Record<string, unknown>) => Promise<ToolOutput>>();
    const configs = new Map<string, { outputSchema?: z.ZodType }>();
    const server = { registerTool(name: string, config: { outputSchema?: z.ZodType }, callback: (args: Record<string, unknown>) => Promise<ToolOutput>) { configs.set(name, config); callbacks.set(name, callback); } };
    const context = {
      db: wrapReadOnlyDatabase(raw), userId: '51bda642-e203-42e2-9f6e-fb0b2f5c4c77',
      clientId: 'client-1', correlationId: 'correlation-1', registeredToolNames: [],
      resourceOrigin: 'https://studio.example/api/mcp',
    };
    registerValidateItemTool(server as never, context);
    registerPrepareImportTool(server as never, context);
    registerVerifyImportTool(server as never, context);

    const proposal = { courseId: 'course-a', itemId: 'intro', baseItemHash: hash(item),
      edits: [{ op: 'replace', path: '/blocks/0/content/0/text', value: 'Updated.' }] };
    for (const tool of ['validate_item', 'prepare_import']) {
      const missingHash = await callbacks.get(tool)!({ courseId: 'course-a', itemId: 'intro', document: item });
      expect(JSON.parse(missingHash.content[0].text).error.code).toBe('BASE_HASH_REQUIRED');
    }
    const validated = await callbacks.get('validate_item')!(proposal);
    expect(validated.structuredContent).toMatchObject({ valid: true, reviewPending: false });
    expect(configs.get('validate_item')?.outputSchema?.safeParse(validated.structuredContent).success).toBe(true);
    const prepared = await callbacks.get('prepare_import')!(proposal);
    expect(prepared.structuredContent).toMatchObject({ ready: true, baseItemHash: hash(item), studioUrl: 'https://studio.example/studio/courses/course-a' });
    expect(prepared.structuredContent?.preparationProof).toMatch(/^v1\.[0-9]{13}\.[0-9a-f]{64}$/);
    expect(configs.get('prepare_import')?.outputSchema?.safeParse(prepared.structuredContent).success).toBe(true);
    const data = prepared.structuredContent!;
    const verifyArgs = { courseId: 'course-a', itemId: 'intro', baseItemHash: data.baseItemHash,
      proposedItemHash: data.proposedItemHash, importText: data.importText };
    const signedVerifyArgs = { ...verifyArgs, preparationProof: data.preparationProof };
    const unsaved = await callbacks.get('verify_import')!(signedVerifyArgs);
    expect(unsaved.structuredContent).toMatchObject({ status: 'NOT_SAVED_YET' });
    expect(configs.get('verify_import')?.outputSchema?.safeParse(unsaved.structuredContent).success).toBe(true);
    storedItem = JSON.parse(data.importText as string);
    const verified = await callbacks.get('verify_import')!(signedVerifyArgs);
    expect(verified.structuredContent).toMatchObject({ status: 'VERIFIED' });
    const alteredText = (data.importText as string).replace('Updated.', 'Altered.');
    const draftReadsBeforeTamper = operations.filter(operation => operation === 'rpc:studio_get_draft_snapshot').length;
    const altered = await callbacks.get('verify_import')!({
      ...signedVerifyArgs, importText: alteredText, proposedItemHash: hash(JSON.parse(alteredText)),
    });
    expect(JSON.parse(altered.content[0].text).error.code).toBe('PREPARATION_PROOF_INVALID');
    expect(operations.filter(operation => operation === 'rpc:studio_get_draft_snapshot')).toHaveLength(draftReadsBeforeTamper);
    const largeDocument = {
      ...item,
      blocks: Array.from({ length: 6 }, (_, index) => ({
        id: `paragraph-${index + 1}`, type: 'paragraph', content: [{ text: 'A'.repeat(3_000) }],
      })),
    };
    const large = await callbacks.get('prepare_import')!({
      courseId: 'course-a', itemId: 'intro', baseItemHash: hash(storedItem), document: largeDocument,
    });
    expect(large.structuredContent).toMatchObject({ ready: true, payloadInText: true });
    expect(large.structuredContent?.preparationProof).toMatch(/^v1\./);
    expect(large.structuredContent).not.toHaveProperty('importText');
    expect(JSON.parse(large.content[0].text).importText).toBe(JSON.stringify(largeDocument, null, 2));
    expect(configs.get('prepare_import')?.outputSchema?.safeParse(large.structuredContent).success).toBe(true);
    const legacyBody = 'PRIVATE_LEGACY_BODY';
    storedItem = { ...item, blocks: Array.from({ length: 25 }, () => ({
      type: 'paragraph', content: [{ text: legacyBody }],
    })) };
    const legacy = await callbacks.get('validate_item')!({
      courseId: 'course-a', itemId: 'intro', baseItemHash: hash(storedItem),
      edits: [{ op: 'replace', path: '/title', value: 'Revised title' }],
    });
    const legacyWarning = (legacy.structuredContent?.warnings as Array<{ code: string; meta?: { count: number; paths: string[] } }> | undefined)
      ?.find(issue => issue.code === 'W_PROFILE_LEGACY_UNCHANGED');
    expect(legacyWarning?.meta?.count).toBeGreaterThanOrEqual(25);
    expect(legacyWarning?.meta?.paths).toHaveLength(20);
    expect(JSON.stringify(legacy.structuredContent)).not.toContain(legacyBody);
    expect(configs.get('validate_item')?.outputSchema?.safeParse(legacy.structuredContent).success).toBe(true);
    vi.stubEnv('STUDIO_MCP_PREPARATION_PROOF_SECRET', '');
    const draftReadsBeforeMissingKey = operations.filter(operation => operation === 'rpc:studio_get_draft_snapshot').length;
    for (const tool of ['validate_item', 'prepare_import']) {
      const missingKey = await callbacks.get(tool)!({
        courseId: 'course-a', itemId: 'intro', baseItemHash: hash(storedItem),
        edits: [{ op: 'replace', path: '/title', value: 'Revised title' }],
      });
      expect(JSON.parse(missingKey.content[0].text).error.code).toBe('SERVICE_UNAVAILABLE');
      expect(operations.filter(operation => operation === 'rpc:studio_get_draft_snapshot')).toHaveLength(draftReadsBeforeMissingKey);
    }
    expect(operations.every(operation => operation.startsWith('select:') || operation.startsWith('rpc:'))).toBe(true);
    expect(operations).not.toContain('rpc:studio_save_workspace');
    expect(JSON.stringify(logged.mock.calls)).not.toContain(data.preparationProof as string);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('ab'.repeat(32));
    expect(serviceMock).not.toHaveBeenCalled();
  });
});
