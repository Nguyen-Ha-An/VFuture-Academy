import { describe, it, expect } from 'vitest';
import { parseWorkspace } from '@/content-engine/validate/workspace';
import { assessWorkspace } from '@/content-engine/validate/assess';
import { checkIds } from '@/content-engine/validate/semantic/ids';
import { checkStructure } from '@/content-engine/validate/semantic/structure';
import { checkAnswers, checkQuestion } from '@/content-engine/validate/semantic/answers';
import type { Question } from '@/content-engine/schema/questions';

const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const rc = (t: string) => ({ blocks: [p(t)] });
const sc = (id: string, key = 'a') => ({ id, type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: key });
const course = (items: unknown[], extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, kind: 'course', id: 'c', title: 'C', summary: 's', languages: ['vi'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['o'], access: { scope: 'global' }, modules: [{ id: 'm1', title: 'M', items }], ...extra });
const lesson = (id: string, blocks: unknown[]) => ({ schemaVersion: 1, kind: 'lesson', id, title: id, blocks });
const parsed = (manifest: unknown, items: Record<string, unknown>) => { const r = parseWorkspace({ manifest, items }); if (!r.parsed) throw new Error(JSON.stringify(r.diagnostics)); return r.parsed; };
const codes = (ds: { code: string }[]) => ds.map((d) => d.code);

describe('checkIds', () => {
  it('flags duplicate item ids across modules, block ids, and question ids per quiz', () => {
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }, { type: 'lesson', id: 'l1' }]), { l1: lesson('l1', [{ id: 'quiz-1', type: 'quiz', questions: [sc('q1'), sc('q1')] }, { id: 'quiz-1', type: 'reflection', prompt: rc('?') }]) });
    const ds = checkIds(ws);
    expect(codes(ds)).toEqual(['E_DUPLICATE_ID', 'E_DUPLICATE_ID', 'E_DUPLICATE_ID']);
    expect(ds.map((d) => d.path)).toEqual(['/modules/0/items/1/id', '/blocks/1/id', '/blocks/0/questions/1/id']);
  });
  it('treats matching left and right ids as separate namespaces', () => {
    const items = (ids: string[]) => ids.map((id) => ({ id, content: rc(id) }));
    const matching = (left: string[], right: string[]) => ({ id: 'm1', type: 'matching', content: rc('m'), left: items(left), right: items(right), correctAnswer: left.map((l, i) => ({ left: l, right: right[i] ?? right[0] })) });
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: lesson('l1', [{ id: 'quiz-1', type: 'quiz', questions: [matching(['1', '2'], ['1', '2'])] }]) });
    expect(codes(checkIds(ws))).toEqual([]);
    const dup = parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: lesson('l1', [{ id: 'quiz-1', type: 'quiz', questions: [matching(['1', '1'], ['r1', 'r2'])] }]) });
    expect(checkIds(dup)).toMatchObject([{ code: 'E_DUPLICATE_ID', path: '/blocks/0/questions/0/left/1/id' }]);
  });
  it('flags duplicate option ids inside a question and ids inside containers', () => {
    const q = { ...sc('q1'), options: [{ id: 'a', content: rc('A') }, { id: 'a', content: rc('B') }] };
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: lesson('l1', [{ id: 'acc', type: 'accordion', items: [{ id: 'i', title: 't', blocks: [p('x')] }, { id: 'i', title: 't', blocks: [p('y')] }] }, { id: 'quiz-1', type: 'quiz', questions: [q] }]) });
    expect(checkIds(ws).map((d) => d.path)).toEqual(['/blocks/0/items/1/id', '/blocks/1/questions/0/options/1/id']);
  });
  it('requires assignment presentation ids to be unique across referenced course items', () => {
    const assignment = (id: string) => ({
      id, type: 'assignment', title: id, instructions: rc('Do it'), submission: { accepts: ['text'] },
    });
    const duplicateInline = parsed(course([{ type: 'lesson', id: 'l1' }, { type: 'lesson', id: 'l2' }]), {
      l1: lesson('l1', [assignment('same')]),
      l2: lesson('l2', [assignment('same')]),
    });
    const standaloneCollision = parsed(course([
      { type: 'assignment', id: 'same', title: 'Standalone', instructions: rc('Do it'), submission: { accepts: ['text'] } },
      { type: 'lesson', id: 'l1' },
    ]), { l1: lesson('l1', [assignment('same')]) });
    const ownLessonId = parsed(course([{ type: 'lesson', id: 'l1' }]), {
      l1: lesson('l1', [assignment('l1')]),
    });

    expect(codes(checkIds(duplicateInline))).toContain('E_DUPLICATE_ID');
    expect(codes(checkIds(standaloneCollision))).toContain('E_DUPLICATE_ID');
    expect(checkIds(ownLessonId)).toEqual([]);
  });
});

describe('assessWorkspace', () => {
    const assess = (manifest: unknown, items: Record<string, unknown>, opts?: { courseId?: string; requireComplete?: boolean }) =>
      codes(assessWorkspace({ manifest, items }, opts).diagnostics);

  it('detects missing documents, orphans, kind mismatch and stub metadata mismatch', () => {
    const ds = assess(course([{ type: 'lesson', id: 'l1', title: 'Manifest title' }, { type: 'exam', id: 'e1' }]), { l1: lesson('l1', [p('x')]), e1: lesson('e1', [p('y')]), orphan: lesson('orphan', [p('z')]) });
    expect(ds.sort()).toEqual(['E_ITEM_KIND_MISMATCH', 'W_ORPHAN_ITEM_DOCUMENT', 'W_STUB_METADATA_MISMATCH']);
    expect(assess(course([{ type: 'lesson', id: 'missing' }]), {})).toEqual(['E_MISSING_ITEM_DOCUMENT']);
  });
  it('escalates an orphan document to an error only for a saveable workspace', () => {
    const manifest = course([{ type: 'lesson', id: 'l1' }]);
    const items = { l1: lesson('l1', [p('x')]), orphan: lesson('orphan', [p('z')]) };
    expect(assess(manifest, items)).toEqual(['W_ORPHAN_ITEM_DOCUMENT']);
    expect(assess(manifest, items, { requireComplete: true })).toEqual(['E_ORPHAN_ITEM_DOCUMENT']);
  });
  it('reports a document stored under a key that is not its own id', () => {
    const ds = assess(course([{ type: 'lesson', id: 'l1' }]), { l1: lesson('renamed', [p('x')]) });
    expect(ds).toContain('E_ITEM_ID_MISMATCH');
  });
  it('reports a manifest whose id is not the course being written', () => {
    expect(assess(course([{ type: 'lesson', id: 'l1' }]), { l1: lesson('l1', [p('x')]) }, { courseId: 'other' }))
      .toContain('E_WORKSPACE_ID_MISMATCH');
  });
  it('rejects an item that has both an inline body and a separate document', () => {
    const manifest = course([{ type: 'lesson', id: 'l1', title: 'Inline', blocks: [p('inline')] }]);
    expect(assess(manifest, { l1: lesson('l1', [p('separate')]) })).toContain('E_DUPLICATE_ITEM_DOCUMENT');
  });
  it('keeps an item legitimately named "manifest" distinct from the course document', () => {
    const result = assessWorkspace({
      manifest: course([{ type: 'lesson', id: 'manifest' }]),
      items: { manifest: lesson('manifest', [p('x')]) },
    }, { courseId: 'c', requireComplete: true });
    expect(result.ok).toBe(true);
    expect(result.parsed?.items.manifest).toMatchObject({ kind: 'lesson', id: 'manifest' });
  });
  it('compares stub and document titles regardless of locale key order', () => {
    const withTitle = (title: unknown) => ({ ...lesson('l1', [p('x')]), title });
    expect(assess(course([{ type: 'lesson', id: 'l1', title: { en: 'T', vi: 'X' } }]), { l1: withTitle({ vi: 'X', en: 'T' }) })).toEqual([]);
    expect(assess(course([{ type: 'lesson', id: 'l1', title: { vi: 'X' } }]), { l1: withTitle({ vi: 'Y' }) })).toEqual(['W_STUB_METADATA_MISMATCH']);
    expect(assess(course([{ type: 'lesson', id: 'l1', title: { vi: 'X' } }]), { l1: withTitle({ en: 'X' }) })).toEqual(['W_STUB_METADATA_MISMATCH']);
  });
});

describe('checkStructure', () => {
  it('detects nesting deeper than 3 containers', () => {
    const deep = { id: 'a1', type: 'accordion', items: [{ id: 'i', title: 't', blocks: [{ id: 'a2', type: 'accordion', items: [{ id: 'j', title: 't', blocks: [{ type: 'callout', variant: 'info', blocks: [{ id: 'r', type: 'reveal', label: 'x', blocks: [p('deep')] }] }] }] }] }] };
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }]), { l1: lesson('l1', [deep]) });
    expect(checkStructure(ws)).toMatchObject([{ code: 'E_NESTING_TOO_DEEP', path: '/blocks/0/items/0/blocks/0/items/0/blocks/0/blocks/0' }]);
  });
  it('validates completion targets, next_step targets, self prerequisite and exam question limits', () => {
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }], { completion: { rules: [{ type: 'exam_passed', examId: 'nope' }, { type: 'quiz_min_score', lessonId: 'l1', quizId: 'quiz-x', percent: 50 }] }, prerequisites: [{ type: 'course_completion', courseId: 'c' }] }), { l1: lesson('l1', [{ id: 'ns', type: 'next_step', title: 'n', target: { kind: 'lesson', id: 'ghost' } }]) });
    expect(codes(checkStructure(ws)).sort()).toEqual(['E_COMPLETION_TARGET_UNKNOWN', 'E_COMPLETION_TARGET_UNKNOWN', 'E_NEXT_STEP_TARGET_UNKNOWN', 'E_PREREQ_SELF']);
  });
  it('accepts an inline assignment completion target, including the surrounding lesson id', () => {
    const assignment = {
      id: 'l1', type: 'assignment', title: 'Inline assignment', instructions: rc('Complete it'),
      submission: { accepts: ['text'] },
    };
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }], {
      completion: { rules: [{ type: 'assignment_approved', assignmentId: 'l1' }] },
    }), { l1: lesson('l1', [assignment]) });

    expect(checkStructure(ws)).toEqual([]);
  });
  it('does not accept an assignment block from an orphan lesson as a completion target', () => {
    const orphanAssignment = {
      id: 'orphan-task', type: 'assignment', title: 'Orphan', instructions: rc('Complete it'),
      submission: { accepts: ['text'] },
    };
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }], {
      completion: { rules: [{ type: 'assignment_approved', assignmentId: 'orphan-task' }] },
    }), {
      l1: lesson('l1', [p('Referenced')]),
      orphan: lesson('orphan', [orphanAssignment]),
    });

    expect(codes(checkStructure(ws))).toContain('E_COMPLETION_TARGET_UNKNOWN');
  });
});

describe('checkQuestion', () => {
  const run = (q: unknown) => codes(checkQuestion(q as Question, '/q', 'd'));
  it('requires keys on auto types, warns on manual keys', () => {
    expect(run({ ...sc('q'), correctAnswer: undefined })).toEqual(['E_AUTO_TYPE_MISSING_KEY']);
    expect(run({ ...sc('q'), correctAnswer: undefined, selfAssessment: true })).toEqual([]);
    expect(run({ id: 'e', type: 'essay', content: rc('x'), correctAnswer: 'x' })).toEqual(['W_IGNORED_ANSWER_KEY']);
  });
  it('checks option references and multiple-choice constraints', () => {
    expect(run(sc('q', 'z'))).toEqual(['E_ANSWER_REF_UNKNOWN']);
    expect(run({ id: 'm', type: 'multiple_choice', content: rc('x'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: ['a', 'a'] })).toEqual(['E_ANSWER_SHAPE']);
    expect(run({ id: 'm', type: 'multiple_choice', content: rc('x'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: ['a', 'b'], maxSelections: 1 })).toEqual(['E_ANSWER_SHAPE']);
  });
  it('checks blanks: declared vs used, keys, word bank and dropdown values, blank runs outside fill_blank', () => {
    const fb = (over: Record<string, unknown>) => ({ id: 'f', type: 'fill_blank', content: { blocks: [{ type: 'paragraph', content: [{ text: 'A ' }, { blank: 'b1' }] }] }, blanks: [{ id: 'b1' }], correctAnswer: { b1: 'x' }, ...over });
    expect(run(fb({}))).toEqual([]);
    expect(run(fb({ blanks: [{ id: 'b1' }, { id: 'b2' }] }))).toEqual(['E_BLANK_UNUSED', 'E_ANSWER_SHAPE']);
    expect(run(fb({ blanks: [{ id: 'b9' }], correctAnswer: { b9: 'x' } }))).toEqual(['E_BLANK_UNDECLARED', 'E_BLANK_UNUSED']);
    expect(run(fb({ correctAnswer: { b1: 'x', zz: 'y' } }))).toEqual(['E_ANSWER_REF_UNKNOWN']);
    expect(run(fb({ display: { interactionType: 'word_bank' }, wordBank: [{ id: 'w1', text: 'x' }, { id: 'w2', text: 'y' }], correctAnswer: { b1: 'w9' } }))).toEqual(['E_ANSWER_REF_UNKNOWN']);
    expect(run(fb({ display: { interactionType: 'dropdown' }, blanks: [{ id: 'b1', options: ['x', 'y'] }], correctAnswer: { b1: 'z' } }))).toEqual(['E_ANSWER_REF_UNKNOWN']);
    expect(run({ ...sc('q'), content: { blocks: [{ type: 'paragraph', content: [{ blank: 'b1' }] }] } })).toEqual(['E_BLANK_OUTSIDE_FILL_BLANK']);
  });
  it('checks matching, ordering, classification keys', () => {
    const items = (ids: string[]) => ids.map((id) => ({ id, content: rc(id) }));
    expect(run({ id: 'x', type: 'matching', content: rc('m'), left: items(['l1', 'l2']), right: items(['r1', 'r2']), correctAnswer: [{ left: 'l1', right: 'r1' }] })).toEqual(['E_ANSWER_SHAPE']); // l2 unmatched
    expect(run({ id: 'x', type: 'matching', content: rc('m'), left: items(['l1', 'l2']), right: items(['r1', 'r2']), correctAnswer: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r1' }] })).toEqual(['E_ANSWER_SHAPE']); // many-to-one without flag
    expect(run({ id: 'x', type: 'ordering', content: rc('o'), items: items(['a', 'b', 'c']), correctAnswer: ['a', 'b'] })).toEqual(['E_ORDERING_NOT_PERMUTATION']);
    expect(run({ id: 'x', type: 'classification', content: rc('c'), categories: [{ id: 'c1', label: 'x' }, { id: 'c2', label: 'y' }], items: items(['i1', 'i2']), correctAnswer: { i1: 'c1' } })).toEqual(['E_ANSWER_SHAPE']);
    expect(run({ id: 'x', type: 'classification', content: rc('c'), categories: [{ id: 'c1', label: 'x' }, { id: 'c2', label: 'y' }], items: items(['i1', 'i2']), correctAnswer: { i1: 'c1', i2: 'zz' } })).toEqual(['E_ANSWER_REF_UNKNOWN']);
  });
  it('rejects unknown interaction types and invalid regexes', () => {
    expect(run({ ...sc('q'), display: { interactionType: 'circle' } })).toEqual(['E_PLAYER_UNKNOWN']);
    expect(run({ id: 's', type: 'short_answer', content: rc('x'), matchMode: 'regex', correctAnswer: ['('] })).toEqual(['E_ANSWER_SHAPE']);
  });
  it('recurses into groups', () => {
    const ds = checkQuestion({ id: 'g', type: 'question_group', sharedContent: rc('p'), questions: [sc('c1', 'zz')] } as unknown as Question, '/q', 'd');
    expect(ds).toMatchObject([{ code: 'E_ANSWER_REF_UNKNOWN', path: '/q/questions/0/correctAnswer' }]);
  });
  it('checkAnswers walks every quiz and exam section', () => {
    const ws = parsed(course([{ type: 'lesson', id: 'l1' }, { type: 'exam', id: 'e1' }]), { l1: lesson('l1', [{ id: 'quiz-1', type: 'quiz', questions: [sc('q1', 'zz')] }]), e1: { schemaVersion: 1, kind: 'exam', id: 'e1', title: 'E', sections: [{ id: 's1', title: 'S', questions: [sc('q2', 'zz'), { $ref: 'bank:x' }] }] } });
    expect(checkAnswers(ws).map((d) => `${d.docId}${d.path}`)).toEqual(['l1/blocks/0/questions/0/correctAnswer', 'e1/sections/0/questions/0/correctAnswer']);
  });
});
