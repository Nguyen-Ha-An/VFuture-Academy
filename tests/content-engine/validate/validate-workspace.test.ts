import { describe, it, expect } from 'vitest';
import { validateWorkspace, validateStandaloneDocument } from '@/content-engine/validate';
import { InMemoryResolver } from '@/content-engine/validate/semantic/refs';

const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const rc = (t: string) => ({ blocks: [p(t)] });
const sc = { id: 'q1', type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a', explanation: rc('e') };
const manifest = { schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 's', languages: ['vi'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['o'], access: { scope: 'global' }, skills: [{ id: 'k', name: 'K' }], relatedOpportunities: [], modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }, { type: 'assignment', id: 'a1', title: 'A', instructions: rc('do'), submission: { accepts: ['link'] } }] }] };
const l1 = { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', objectives: ['o'], blocks: [p('x'), { id: 'q', type: 'quiz', questions: [sc] }, { type: 'math', latex: 'x^2' }] };
const resolver = new InMemoryResolver({});

describe('validateWorkspace', () => {
  it('returns a report with summary, ranges from sources, and renderer support as warning in draft / error at publish', async () => {
    const sources = { manifest: JSON.stringify(manifest, null, 2), l1: JSON.stringify(l1, null, 2) };
    const draft = await validateWorkspace({ manifest, items: { l1 }, sources }, resolver);
    expect(draft.ok).toBe(true);
    expect(draft.warnings.map((w) => w.code)).toContain('E_RENDERER_UNSUPPORTED');
    expect(draft.warnings.find((w) => w.code === 'E_RENDERER_UNSUPPORTED')?.range?.start.line).toBeGreaterThan(1);
    expect(draft.summary).toMatchObject({ modules: 1, items: { lesson: 1, exam: 0, assignment: 1 }, questions: { single_choice: 1 }, totalPoints: 1, languages: ['vi'] });
    const publish = await validateWorkspace({ manifest, items: { l1 } }, resolver, { publish: true });
    expect(publish.ok).toBe(false);
    expect(publish.errors.map((e) => e.code)).toEqual(['E_RENDERER_UNSUPPORTED']);
  });
  it('reports an invalid item document once, not also as a missing document', async () => {
    const r = await validateWorkspace({ manifest, items: { l1: { ...l1, blocks: [] } } }, resolver);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('E_SCHEMA');
    expect(r.errors.find((e) => e.code === 'E_SCHEMA')).toMatchObject({ docId: 'l1', path: '/blocks' });
    expect(r.errors.map((e) => e.code)).not.toContain('E_MISSING_ITEM_DOCUMENT');
  });
  it('stops at structural errors of the manifest', async () => {
    const r = await validateWorkspace({ manifest: { ...manifest, level: 'pro' }, items: { l1 } }, resolver);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: 'E_SCHEMA', docId: 'manifest', path: '/level' });
  });
});

describe('validateStandaloneDocument', () => {
  it('validates a question bundle including answer checks', async () => {
    const r = await validateStandaloneDocument({ schemaVersion: 1, kind: 'question_bundle', id: 'b', languages: ['vi'], defaultLanguage: 'vi', questions: [{ ...sc, correctAnswer: 'zz' }] }, 'b', resolver);
    expect(r.report.errors.map((e) => `${e.code}${e.path}`)).toEqual(['E_ANSWER_REF_UNKNOWN/questions/0/correctAnswer']);
  });
  it('rejects an answer key on a manually-graded question instead of merely warning', async () => {
    // Tolerating the field and warning about it let an answer key nothing grades reach
    // storage; the manual schemas are strict, so it is now refused outright.
    const essay = { id: 'e1', type: 'essay', content: rc('Write about x'), correctAnswer: 'x' };
    const r = await validateStandaloneDocument({ schemaVersion: 1, kind: 'question_bundle', id: 'b2', languages: ['vi'], defaultLanguage: 'vi', questions: [essay] }, 'b2', resolver);
    expect(r.ok).toBe(false);
    expect(r.report.errors).toMatchObject([{ code: 'E_SCHEMA', path: '/questions/0', meta: { detail: 'Unrecognized key: "correctAnswer"' } }]);
  });
  it('rejects disallowed external media in a standalone resource', async () => {
    const r = await validateStandaloneDocument({
      schemaVersion: 1,
      kind: 'resource',
      id: 'unsafe-resource',
      languages: ['vi'],
      defaultLanguage: 'vi',
      title: 'Unsafe resource',
      summary: 'Contains an untrusted image host',
      resourceType: 'guide',
      body: { blocks: [{ type: 'image', src: { url: 'https://attacker.example/image.png' }, alt: 'Example' }] },
    }, 'unsafe-resource', resolver);

    expect(r.ok).toBe(false);
    expect(r.report.errors).toContainEqual(expect.objectContaining({
      code: 'E_MEDIA_HOST_NOT_ALLOWED',
      docId: 'unsafe-resource',
      path: '/body/blocks/0/src/url',
    }));
  });
  it('uses the standalone resolver to reject unknown media assets', async () => {
    const r = await validateStandaloneDocument({
      schemaVersion: 1,
      kind: 'question_bundle',
      id: 'asset-bundle',
      languages: ['vi'],
      defaultLanguage: 'vi',
      questions: [{
        ...sc,
        content: { blocks: [{ type: 'image', src: { assetId: 'missing-asset' }, alt: 'Example' }] },
      }],
    }, 'asset-bundle', new InMemoryResolver({ assets: [] }));

    expect(r.ok).toBe(false);
    expect(r.report.errors).toContainEqual(expect.objectContaining({
      code: 'E_ASSET_UNKNOWN',
      docId: 'asset-bundle',
      path: '/questions/0/content/blocks/0/src/assetId',
    }));
  });
});
