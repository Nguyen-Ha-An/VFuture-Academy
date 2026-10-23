import { describe, it, expect } from 'vitest';
import { compileCourse, assertNoAnswerKeys, toLearnerQuestion, normalizeQuizSettings, normalizeExamSettings, compileBankQuestion } from '@/content-engine/compile';
import { stableStringify, sha256Hex } from '@/content-engine/compile/checksum';
import { InMemoryResolver } from '@/content-engine/validate';
import type { Question } from '@/content-engine/schema/questions';

const p = (t: string, en?: string) => en ? { vi: { blocks: [{ type: 'paragraph', content: [{ text: t }] }] }, en: { blocks: [{ type: 'paragraph', content: [{ text: en }] }] } } : { blocks: [{ type: 'paragraph', content: [{ text: t }] }] };
const sc = (id: string) => ({ id, type: 'single_choice', points: 2, content: p('Câu hỏi?', 'Question?'), options: [{ id: 'a', content: p('A'), feedback: p('good') }, { id: 'b', content: p('B') }], correctAnswer: 'a', explanation: p('vì', 'because'), skills: ['k'] });
const manifest = { schemaVersion: 1, kind: 'course', id: 'c', title: { vi: 'K', en: 'C' }, summary: 's', languages: ['vi', 'en'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['o'], access: { scope: 'global' }, skills: [{ id: 'k', name: 'K' }], modules: [{ id: 'm1', title: { vi: 'M', en: 'Mod' }, items: [{ type: 'lesson', id: 'l1' }, { type: 'exam', id: 'e1' }, { type: 'assignment', id: 'a1', title: 'A', instructions: p('do'), submission: { accepts: ['link'], linkHosts: ['github.com'] }, rubric: { criteria: [{ id: 'c1', name: 'C', maxPoints: 5 }] }, passPoints: 4, skills: ['k'], resubmission: 'once' }] }] };
const l1 = { schemaVersion: 1, kind: 'lesson', id: 'l1', title: { vi: 'Bài 1', en: 'Lesson 1' }, blocks: [{ type: 'paragraph', content: [{ text: 'x' }] }, { id: 'quiz-1', type: 'quiz', questions: [sc('q1'), { $ref: 'bank:b1' }, { id: 'g', type: 'question_group', sharedContent: p('read'), questions: [sc('c1')] }], settings: { mode: 'graded' } }, { id: 'ref-1', type: 'reflection', prompt: p('?'), required: true }, { id: 'rev', type: 'reveal', label: 'show', blocks: [{ type: 'paragraph', content: [{ text: 'hidden' }] }] }] };
const e1 = { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', settings: { timeLimitMinutes: 10 }, sections: [{ id: 's1', title: 'S', questions: [sc('q2'), { $pool: { id: 'pool-a', count: 1, pointsEach: 3, filter: { tags: ['t'] } } }] }] };
const resolver = new InMemoryResolver({ bank: [{ id: 'b1', versionId: 'v-b1', question: sc('b1'), tags: ['t'], difficulty: 'easy', type: 'single_choice' }, { id: 'b2', versionId: 'v-b2', question: sc('b2'), tags: ['t'], type: 'single_choice' }] });

describe('checksum', () => {
  it('stableStringify sorts keys; sha256 is deterministic', async () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('defaults', () => {
  it('quiz and exam settings', () => {
    expect(normalizeQuizSettings(undefined)).toEqual({ mode: 'practice', attemptsAllowed: 0, feedback: 'per_question', showExplanations: true, shuffleQuestions: false, required: true });
    expect(normalizeQuizSettings({ mode: 'graded' })).toMatchObject({ attemptsAllowed: 3, feedback: 'after_submit' });
    expect(normalizeExamSettings({ timeLimitMinutes: 10 })).toMatchObject({ attemptsAllowed: 1, scoringPolicy: 'best', passPercent: 50, review: { showScore: 'immediately', showCorrectAnswers: 'on_release', showExplanations: 'on_release', releaseAt: null }, navigation: 'free', layout: 'one_per_page', integrity: { logFocusLoss: true, logPaste: true, requireFullscreen: false }, required: true, lateSubmission: 'reject' });
  });
});

describe('projection', () => {
  it('strips answer keys, explanations, feedback and samples, recursively', () => {
    const learner = toLearnerQuestion({ id: 'g', type: 'question_group', sharedContent: p('r'), questions: [sc('c1') as unknown as Question] } as unknown as Question);
    expect(() => assertNoAnswerKeys(learner)).not.toThrow();
    expect(() => assertNoAnswerKeys(sc('x'))).toThrow(/feedback|correctAnswer/);
  });
  it('does not recurse into settings or display, but still flags option feedback', () => {
    expect(() => assertNoAnswerKeys({ settings: { feedback: 'per_question' } })).not.toThrow();
    expect(() => assertNoAnswerKeys({ display: { feedback: 'x' } })).not.toThrow();
    expect(() => assertNoAnswerKeys({ options: [{ id: 'a', feedback: {} }] })).toThrow(/feedback/);
    expect(() => assertNoAnswerKeys({ correctAnswer: 'a' })).toThrow(/correctAnswer/);
  });
});

describe('compileCourse', () => {
  it('pins notebook configuration in learner and grading snapshots', async () => {
    const notebook = {
      runtimeMode: 'jupyterlite' as const,
      templateAssetId: 'asset-template', templateChecksum: 'a'.repeat(64),
      runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1',
      datasets: [{ assetId: 'asset-data', checksum: 'b'.repeat(64), filename: 'input.csv' }],
    };
    const notebookManifest = {
      ...manifest,
      modules: manifest.modules.map((module) => ({
        ...module,
        items: module.items.map((item) => item.id === 'a1' ? { ...item, notebook } : item),
      })),
    };
    const r = await compileCourse({ manifest: notebookManifest, items: { l1, e1 } }, new InMemoryResolver({
      bank: [
        { id: 'b1', versionId: 'v-b1', question: sc('b1'), tags: ['t'], difficulty: 'easy', type: 'single_choice' },
        { id: 'b2', versionId: 'v-b2', question: sc('b2'), tags: ['t'], type: 'single_choice' },
      ],
      assets: ['asset-template', 'asset-data'],
    }), { locales: ['vi'] });

    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.compiled!.items.a1.renders.vi.notebook).toEqual(notebook);
    expect(r.compiled!.items.a1.grading.assignments?.a1.notebook).toEqual(notebook);
  });
  it('carries the authored course code and prerequisite ids into catalog meta', async () => {
    const withMeta = { ...manifest, code: 'VF-CF-101', prerequisites: [{ type: 'course_completion', courseId: 'intro' }] };
    const r = await compileCourse({ manifest: withMeta, items: { l1, e1 } }, resolver, { locales: ['vi'] });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.compiled!.meta).toMatchObject({ code: 'VF-CF-101', prerequisites: ['intro'] });
    const plain = await compileCourse({ manifest, items: { l1, e1 } }, resolver, { locales: ['vi'] });
    expect(plain.compiled!.meta).not.toHaveProperty('code');
    expect(plain.compiled!.meta).not.toHaveProperty('prerequisites');
  });
  it('produces per-locale learner renders with composite ids and a grading payload', async () => {
    const r = await compileCourse({ manifest, items: { l1, e1 } }, resolver, { locales: ['vi', 'en'] });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const c = r.compiled!;
    expect(c.outline.modules[0].items.map((i) => i.id)).toEqual(['l1', 'e1', 'a1']);
    expect(Object.keys(c.items).sort()).toEqual(['a1', 'e1', 'l1']);
    const l = c.items.l1;
    expect(l.renders.en.title).toBe('Lesson 1');
    expect(l.renders.vi.title).toBe('Bài 1');
    const quiz = (l.renders.en as unknown as { blocks: { type: string; questions?: { id: string; content: unknown }[] }[] }).blocks[1];
    expect(quiz.questions!.map((q) => q.id)).toEqual(['quiz-1/q1', 'quiz-1/b1', 'quiz-1/g']);
    expect(() => assertNoAnswerKeys(l.renders.en)).not.toThrow();
    expect(Object.keys(l.grading.questions).sort()).toEqual(['quiz-1/b1', 'quiz-1/g', 'quiz-1/g/c1', 'quiz-1/q1']);
    expect(l.grading.questions['quiz-1/b1']).toMatchObject({ correctAnswer: 'a', points: 2, sourceRef: 'v-b1', interactionType: 'radio' });
    expect(l.grading.quizzes['quiz-1']).toMatchObject({ mode: 'graded', attemptsAllowed: 3, questionIds: ['quiz-1/q1', 'quiz-1/b1', 'quiz-1/g'] });
    expect(l.grading.activities).toEqual([{ id: 'quiz-1', type: 'quiz', required: true }, { id: 'ref-1', type: 'reflection', required: true }, { id: 'rev', type: 'reveal', required: false }]);
    expect(l.grading.lessonCompletionMode).toBe('activities');
    const e = c.items.e1;
    const sec = (e.renders.vi as unknown as { sections: { questions: unknown[] }[] }).sections[0];
    expect(sec.questions[1]).toEqual({ $pool: { id: 'pool-a', count: 1, pointsEach: 3 } });
    expect(e.grading.exam).toMatchObject({ timeLimitMinutes: 10, sections: [{ id: 's1', questionIds: ['s1/q2'], pools: [{ id: 'pool-a', count: 1, pointsEach: 3, filter: { tags: ['t'] }, sectionId: 's1' }] }] });
    expect(e.grading.questions['s1/q2'].skills).toEqual(['k']);
    expect(c.items.a1.grading.rubrics.a1.criteria[0].maxPoints).toBe(5);
    expect(c.items.a1.grading.assignments?.a1).toEqual({
      submission: { accepts: ['link'], linkHosts: ['github.com'] },
      passPoints: 4,
      skills: ['k'],
      resubmission: 'once',
    });
    expect(c.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(l.checksum).not.toBe(e.checksum);
  });
  it('keeps a legal quiz settings.feedback in the learner render', async () => {
    const graded = { ...l1, blocks: l1.blocks.map((b) => ((b as { id?: string }).id === 'quiz-1' ? { ...b, settings: { mode: 'graded', feedback: 'per_question' } } : b)) };
    const r = await compileCourse({ manifest, items: { l1: graded, e1 } }, resolver, { locales: ['vi'] });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const quiz = (r.compiled!.items.l1.renders.vi as unknown as { blocks: { settings?: { feedback?: string } }[] }).blocks[1];
    expect(quiz.settings?.feedback).toBe('per_question');
  });
  it('pins resolved bank versions into the item and course checksums', async () => {
    const bank = (versionId: string) => new InMemoryResolver({ bank: [{ id: 'b1', versionId, question: sc('b1'), tags: ['t'], difficulty: 'easy', type: 'single_choice' }, { id: 'b2', versionId: 'v-b2', question: sc('b2'), tags: ['t'], type: 'single_choice' }] });
    const ws = { manifest, items: { l1, e1 } };
    const a = await compileCourse(ws, bank('v-b1'), { locales: ['vi'] });
    const b = await compileCourse(ws, bank('v-b1-2'), { locales: ['vi'] });
    const again = await compileCourse(ws, bank('v-b1'), { locales: ['vi'] });
    expect(a.compiled!.items.l1.checksum).not.toBe(b.compiled!.items.l1.checksum);
    expect(a.compiled!.checksum).not.toBe(b.compiled!.checksum);
    expect(a.compiled!.items.l1.checksum).toBe(again.compiled!.items.l1.checksum);
    expect(a.compiled!.checksum).toBe(again.compiled!.checksum);
  });
  it('fails when validation has errors (publish mode)', async () => {
    const r = await compileCourse({ manifest, items: { l1: { ...l1, blocks: [...l1.blocks, { type: 'math', latex: 'x' }] }, e1 } }, resolver, { publish: true });
    expect(r.ok).toBe(false);
    expect(r.compiled).toBeUndefined();
  });
  it('compiles a bank question on its own', async () => {
    const r = await compileBankQuestion(sc('b9') as unknown as Question, ['vi', 'en']);
    expect(r.grading.correctAnswer).toBe('a');
    expect(() => assertNoAnswerKeys(r.renders.vi)).not.toThrow();
  });
});
