import { describe, it, expect, vi } from 'vitest';

import {
  ResolverUnavailableError,
  perOperationResolver,
  validateStandaloneDocument,
  validateWorkspace,
  type ReferenceResolver,
} from '@/content-engine/validate';

const p = (text: string) => ({ type: 'paragraph', content: [{ text }] });

const manifest = {
  schemaVersion: 1, kind: 'course', id: 'refs', title: 'Refs', summary: 'References.',
  languages: ['en'], defaultLanguage: 'en', level: 'foundation', difficulty: 'beginner',
  pathway: 'core-future-skills', learningOutcomes: ['Resolve.'], access: { scope: 'global' },
  relatedOpportunities: ['sprint-01'],
  modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }],
};
const lesson = {
  schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L1', objectives: ['Learn.'],
  blocks: [p('Body'), { id: 'res', type: 'resource_link', resourceId: 'guide' }],
};
const workspace = { manifest, items: { l1: lesson } };

/**
 * Resolves nothing and fails at nothing: every reference genuinely does not exist.
 *
 * A plain object rather than a spread `InMemoryResolver`: the class keeps its methods
 * on the prototype, so `{ ...new InMemoryResolver({}) }` is an empty object and every
 * override below would silently be the only method present.
 */
const empty: ReferenceResolver = {
  bankQuestion: async () => null,
  bankCandidates: async () => [],
  asset: async () => null,
  resourceExists: async () => false,
  opportunityExists: async () => false,
  branchExists: async () => false,
};

/** Every lookup fails to complete, the way a database outage behaves. */
const unavailable: ReferenceResolver = {
  bankQuestion: () => { throw new ResolverUnavailableError('bankQuestion'); },
  bankCandidates: () => { throw new ResolverUnavailableError('bankCandidates'); },
  asset: () => { throw new ResolverUnavailableError('asset'); },
  resourceExists: () => { throw new ResolverUnavailableError('resourceExists'); },
  opportunityExists: () => { throw new ResolverUnavailableError('opportunityExists'); },
  branchExists: () => { throw new ResolverUnavailableError('branchExists'); },
};

describe('an outage is not the same answer as absence', () => {
  it('reports a missing reference as missing when the lookup succeeded', async () => {
    const report = await validateWorkspace(workspace, empty, { save: true, courseId: 'refs' });
    expect(report.ok).toBe(false);
    expect(report.errors.map((error) => error.code).sort()).toEqual(['E_OPPORTUNITY_UNKNOWN', 'E_RESOURCE_UNKNOWN']);
  });

  it('reports a failed lookup as a lookup failure, never as missing and never as valid', async () => {
    const report = await validateWorkspace(workspace, unavailable, { save: true, courseId: 'refs' });
    expect(report.ok).toBe(false);
    const codes = report.errors.map((error) => error.code);
    expect(new Set(codes)).toEqual(new Set(['E_REFERENCE_LOOKUP_FAILED']));
    // Not silently accepted either: the workspace is not reported as valid.
    expect(codes).not.toContain('E_RESOURCE_UNKNOWN');
    expect(codes).not.toContain('E_OPPORTUNITY_UNKNOWN');
  });

  it('names the operation and the document that could not be checked', async () => {
    const report = await validateWorkspace(workspace, unavailable, { save: true, courseId: 'refs' });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'E_REFERENCE_LOOKUP_FAILED', docId: 'manifest', path: '/relatedOpportunities/0', meta: expect.objectContaining({ operation: 'opportunityExists' }) }),
      expect.objectContaining({ code: 'E_REFERENCE_LOOKUP_FAILED', docId: 'l1', path: '/blocks/1/resourceId' }),
    ]));
  });

  it('does not conclude a pool is unsatisfiable when its candidates could not be listed', async () => {
    const exam = {
      schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', sections: [{
        id: 's1', title: 'S', questions: [{ $pool: { id: 'pool-1', count: 3, filter: { tags: ['ai'] } } }],
      }],
    };
    const withPool = {
      manifest: { ...manifest, relatedOpportunities: [], modules: [{ id: 'm1', title: 'M', items: [{ type: 'exam', id: 'e1' }] }] },
      items: { e1: exam },
    };
    const report = await validateWorkspace(withPool, unavailable, { save: true, courseId: 'refs' });
    const codes = report.errors.map((error) => error.code);
    expect(codes).toContain('E_REFERENCE_LOOKUP_FAILED');
    expect(codes).not.toContain('E_POOL_UNSATISFIABLE');
  });

  it('surfaces an outage from a standalone document too', async () => {
    const bundle = {
      schemaVersion: 1, kind: 'question_bundle', id: 'b1', languages: ['en'], defaultLanguage: 'en',
      questions: [{ id: 'q1', type: 'true_false', content: { blocks: [{ type: 'image', src: { assetId: 'asset_x' }, alt: 'Diagram' }] }, correctAnswer: true }],
    };
    const result = await validateStandaloneDocument(bundle, 'b1', unavailable);
    expect(result.report.errors.map((error) => error.code)).toContain('E_REFERENCE_LOOKUP_FAILED');
  });

  it('lets an unexpected error through rather than reporting it as an outage', async () => {
    const broken: ReferenceResolver = {
      ...empty,
      resourceExists: async () => { throw new TypeError('bug in the adapter'); },
    };
    // Only a ResolverUnavailableError means "could not check"; a genuine bug must not
    // be quietly relabelled as an outage.
    await expect(validateWorkspace(workspace, broken, { save: true, courseId: 'refs' })).rejects.toThrow(TypeError);
  });
});

describe('per-operation reference caching', () => {
  it('asks once per distinct reference within one operation', async () => {
    const asset = vi.fn().mockResolvedValue({ id: 'a', url: 'memory://a', mime: 'image/png' });
    const cached = perOperationResolver({ ...empty, asset });

    await Promise.all([cached.asset('a'), cached.asset('a'), cached.asset('a')]);
    await cached.asset('a');
    expect(asset).toHaveBeenCalledTimes(1);

    await cached.asset('b');
    expect(asset).toHaveBeenCalledTimes(2);
  });

  it('distinguishes filters that differ only in one field', async () => {
    const bankCandidates = vi.fn().mockResolvedValue([]);
    const cached = perOperationResolver({ ...empty, bankCandidates });
    await cached.bankCandidates({ tags: ['a'] });
    await cached.bankCandidates({ tags: ['a'] });
    await cached.bankCandidates({ tags: ['b'] });
    expect(bankCandidates).toHaveBeenCalledTimes(2);
  });

  it('does not remember anything across operations', async () => {
    const asset = vi.fn().mockResolvedValue(null);
    const inner = { ...empty, asset };

    await perOperationResolver(inner).asset('a');
    await perOperationResolver(inner).asset('a');
    // Two operations, two lookups: a cache that outlived the operation would keep
    // answering with a world that has since changed.
    expect(asset).toHaveBeenCalledTimes(2);
  });

  it('caches an outage for the operation instead of retrying it per reference', async () => {
    const resourceExists = vi.fn(async () => { throw new ResolverUnavailableError('resourceExists'); });
    const cached = perOperationResolver({ ...empty, resourceExists });
    await expect(cached.resourceExists('guide')).rejects.toBeInstanceOf(ResolverUnavailableError);
    await expect(cached.resourceExists('guide')).rejects.toBeInstanceOf(ResolverUnavailableError);
    expect(resourceExists).toHaveBeenCalledTimes(1);
  });

  it('is used by validateWorkspace, so a repeated reference costs one lookup', async () => {
    const resourceExists = vi.fn().mockResolvedValue(true);
    const twice = {
      ...lesson,
      blocks: [p('Body'), { id: 'r1', type: 'resource_link', resourceId: 'guide' }, { id: 'r2', type: 'resource_link', resourceId: 'guide' }],
    };
    await validateWorkspace(
      { manifest: { ...manifest, relatedOpportunities: [] }, items: { l1: twice } },
      { ...empty, resourceExists },
      { save: true, courseId: 'refs' },
    );
    expect(resourceExists).toHaveBeenCalledTimes(1);
  });
});
