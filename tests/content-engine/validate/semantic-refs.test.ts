import { describe, it, expect } from 'vitest';
import { parseWorkspace } from '@/content-engine/validate/workspace';
import { InMemoryResolver, checkReferences } from '@/content-engine/validate/semantic/refs';
import { checkL10n } from '@/content-engine/validate/semantic/l10n';
import { checkHosts } from '@/content-engine/validate/semantic/hosts';
import { checkQuality } from '@/content-engine/validate/quality';

const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const rc = (t: string) => ({ blocks: [p(t)] });
const sc = (id: string) => ({ id, type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a', explanation: rc('e') });
const course = (items: unknown[], extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, kind: 'course', id: 'c', title: { vi: 'K', en: 'C' }, summary: { vi: 's', en: 's' }, languages: ['vi', 'en'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: [{ vi: 'o', en: 'o' }], access: { scope: 'global' }, skills: [{ id: 'k', name: 'K' }], modules: [{ id: 'm1', title: { vi: 'M', en: 'M' }, items }], ...extra });
const parsed = (manifest: unknown, items: Record<string, unknown>) => { const r = parseWorkspace({ manifest, items }); if (!r.parsed) throw new Error(JSON.stringify(r.diagnostics)); return r.parsed; };
const codes = (ds: { code: string }[]) => ds.map((d) => d.code).sort();

const resolver = new InMemoryResolver({
  bank: [{ id: 'b1', versionId: 'v1', question: sc('b1'), tags: ['x'], difficulty: 'easy', type: 'single_choice' }, { id: 'b2', versionId: 'v2', question: sc('b2'), tags: ['x'], difficulty: 'hard', type: 'single_choice' }],
  assets: ['asset_ok'], resources: ['res-ok'], opportunities: ['opp-ok'], branches: ['vinsmc'],
});

describe('checkReferences', () => {
  it('passes when everything resolves', async () => {
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }, { type: 'exam', id: 'e1' }], { access: { scope: 'branches', branchIds: ['vinsmc'] }, relatedOpportunities: ['opp-ok'], cover: { assetId: 'asset_ok' } }), {
      l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', blocks: [{ type: 'image', src: { assetId: 'asset_ok' }, alt: 'a' }, { id: 'r', type: 'resource_link', resourceId: 'res-ok' }, { id: 'o', type: 'opportunity_link', opportunityId: 'opp-ok', relationship: 'related' }, { id: 'q', type: 'quiz', questions: [{ $ref: 'bank:b1' }] }] },
      e1: { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', sections: [{ id: 's', title: 'S', questions: [{ $pool: { id: 'p', count: 2, filter: { tags: ['x'] } } }] }] },
    });
    expect(await checkReferences(ws, resolver)).toEqual([]);
  });
  it('excludes bank questions already pinned by a sibling $ref from pool candidates', async () => {
    const ws = parsed(course([{ type: 'exam', id: 'e1' }]), {
      e1: { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', sections: [{ id: 's', title: 'S', questions: [{ $ref: 'bank:b1' }, { $pool: { id: 'p', count: 2, filter: { tags: ['x'] } } }] }] },
    });
    expect(codes(await checkReferences(ws, resolver))).toEqual(['E_POOL_UNSATISFIABLE']);
  });
  it('flags every unresolved reference kind and unsatisfiable pools', async () => {
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }, { type: 'exam', id: 'e1' }], { access: { scope: 'branches', branchIds: ['nope'] }, relatedOpportunities: ['opp-x'] }), {
      l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', blocks: [{ type: 'image', src: { assetId: 'asset_x' }, alt: 'a' }, { id: 'r', type: 'resource_link', resourceId: 'res-x' }, { id: 'q', type: 'quiz', questions: [{ $ref: 'bank:zzz' }] }] },
      e1: { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', sections: [{ id: 's', title: 'S', questions: [{ $pool: { id: 'p', count: 3, filter: { tags: ['x'] } } }, { $pool: { id: 'p2', count: 1, from: ['bank:b1', 'bank:nope'] } }] }] },
    });
    expect(codes(await checkReferences(ws, resolver))).toEqual(['E_ASSET_UNKNOWN', 'E_BRANCH_UNKNOWN', 'E_OPPORTUNITY_UNKNOWN', 'E_POOL_UNSATISFIABLE', 'E_REF_UNRESOLVED', 'E_REF_UNRESOLVED', 'E_RESOURCE_UNKNOWN']);
  });
});

describe('checkL10n', () => {
  const viOnlyCourse = { schemaVersion: 1, kind: 'course', id: 'c', title: 'K', summary: 's', languages: ['vi'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['o'], access: { scope: 'global' }, skills: [{ id: 'k', name: 'K' }], modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'l1' }] }] };
  it('flags a locale outside course.languages, a missing default language, and a document language override', () => {
    const ws = parsed(viOnlyCourse, { l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', languages: ['vi', 'en'], defaultLanguage: 'vi', title: { en: 'Only English' }, blocks: [p('x')] } });
    expect(codes(checkL10n(ws))).toEqual(['E_L10N_MISSING_DEFAULT', 'E_L10N_UNKNOWN_LOCALE', 'W_L10N_LANGUAGE_OVERRIDE']);
  });
  it('warns once per field that lacks a declared secondary language', () => {
    const ws2 = parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: { vi: 'Chỉ Việt' }, blocks: [p('x')] } });
    expect(codes(checkL10n(ws2))).toEqual(['W_L10N_MISSING_TRANSLATION']);
  });
});

describe('checkHosts', () => {
  it('warns on external media and errors on disallowed hosts', () => {
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', blocks: [{ type: 'image', src: { url: 'https://images.unsplash.com/x.png' }, alt: 'a' }, { type: 'audio', src: { url: 'https://evil.example.com/a.mp3' } }] } });
    expect(codes(checkHosts(ws))).toEqual(['E_MEDIA_HOST_NOT_ALLOWED', 'W_EXTERNAL_MEDIA', 'W_EXTERNAL_MEDIA']);
  });
});

describe('checkQuality', () => {
  it('emits the expected warnings', () => {
    const noExpl = { ...sc('q'), explanation: undefined, points: 0, options: [{ id: 'a', content: rc('Same') }, { id: 'b', content: rc('Same') }] };
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }, { type: 'exam', id: 'e1' }], { skills: undefined }), {
      l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', estimatedMinutes: 90, blocks: [{ type: 'image', src: { assetId: 'a' }, alt: '' }, { id: 'q', type: 'quiz', questions: [noExpl] }] },
      e1: { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', sections: [{ id: 's', title: 'S', questions: [sc('x')] }] },
    });
    expect(codes(checkQuality(ws))).toEqual(['W_COURSE_NO_NEXT_STEP', 'W_COURSE_NO_OUTPUT', 'W_COURSE_NO_SKILLS', 'W_DUPLICATE_OPTION_TEXT', 'W_EXAM_NO_TIME_LIMIT', 'W_LESSON_TOO_LONG', 'W_NO_ALT_TEXT', 'W_NO_EXPLANATION', 'W_NO_OBJECTIVES', 'W_POINTS_ZERO']);
  });
  it('compares option texts per course locale', () => {
    const opt = (id: string, vi: string, en: string) => ({ id, content: { blocks: [{ type: 'paragraph', content: [{ text: { vi, en } }] }] } });
    const quiz = (options: unknown[]) => ({ id: 'q', type: 'quiz', questions: [{ ...sc('q1'), options, correctAnswer: 'a' }] });
    const build = (options: unknown[]) => parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: { schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', objectives: ['o'], blocks: [quiz(options)] } });
    const dupes = (ws: ReturnType<typeof parsed>) => checkQuality(ws).filter((d) => d.code === 'W_DUPLICATE_OPTION_TEXT');
    expect(dupes(build([opt('a', 'A', 'B'), opt('b', 'B', 'A')]))).toEqual([]);
    expect(dupes(build([opt('a', 'A', 'B'), opt('b', 'A', 'C')]))).toHaveLength(1);
    expect(dupes(build([opt('a', 'A', 'B'), opt('b', 'C', 'B')]))).toHaveLength(1); // duplicated in en only
  });
});
