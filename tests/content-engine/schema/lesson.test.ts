import { describe, it, expect } from 'vitest';
import { LessonBlockSchema, LessonDocumentSchema, LESSON_BLOCK_TYPES } from '@/content-engine/schema/lesson';
import { ACTIVITY_BLOCK_TYPES, CONTAINER_BLOCK_TYPES } from '@/content-engine/schema/activities';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const sc = { id: 'q1', type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a' };

describe('activity blocks', () => {
  it.each([
    { id: 'quiz-1', type: 'quiz', title: 'Check', questions: [sc, { $ref: 'bank:x-1' }], settings: { mode: 'graded', attemptsAllowed: 2, feedback: 'after_submit', passPercent: 60 } },
    { id: 'asg-1', type: 'assignment', title: 'Ship it', instructions: rc('Build'), submission: { accepts: ['link', 'file'], maxFiles: 2 }, rubric: { criteria: [{ id: 'c', name: 'C', maxPoints: 5 }] }, skills: ['ai-product-thinking'] },
    { id: 'ref-1', type: 'reflection', prompt: rc('What changed?'), required: true, maxChars: 500 },
    { id: 'fc-1', type: 'flashcards', cards: [{ id: 'c1', front: rc('LLM'), back: rc('Large language model') }] },
    { id: 'acc-1', type: 'accordion', items: [{ id: 'i1', title: 'More', blocks: [p('hidden'), sc && { id: 'quiz-in', type: 'quiz', questions: [sc] }] }] },
    { id: 'tabs-1', type: 'tabs', items: [{ id: 't1', title: 'Python', blocks: [{ type: 'code', language: 'python', code: 'x=1' }] }, { id: 't2', title: 'JS', blocks: [{ type: 'code', language: 'javascript', code: 'x=1' }] }] },
    { id: 'rev-1', type: 'reveal', label: { vi: 'Xem đáp án', en: 'Show answer' }, blocks: [p('42')] },
    { id: 'step-1', type: 'stepper', linear: true, steps: [{ id: 's1', title: 'Step 1', blocks: [p('a')] }, { id: 's2', title: 'Step 2', blocks: [p('b')] }] },
    { id: 'rl-1', type: 'resource_link', resourceId: 'prompting-cheat-sheet', label: 'Cheat sheet' },
    { id: 'ol-1', type: 'opportunity_link', opportunityId: 'ai-build-sprint-01', relationship: 'recommended_next_step' },
    { id: 'ns-1', type: 'next_step', title: 'Next', target: { kind: 'exam', id: 'exam-m1' } },
    { type: 'callout', variant: 'tip', blocks: [p('x'), { id: 'fc-2', type: 'flashcards', cards: [{ id: 'c', front: rc('a'), back: rc('b') }] }] },
  ])('accepts %j', (b) => {
    const r = LessonBlockSchema.safeParse(b);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it.each([
    { type: 'quiz', questions: [sc] },                                  // missing id
    { id: 'q', type: 'quiz', questions: [] },                          // empty
    { id: 'q', type: 'quiz', questions: [{ $pool: { id: 'p', count: 1, from: ['bank:a'] } }] }, // pools not in quizzes
    { id: 'a', type: 'assignment', title: 'x', instructions: rc('x'), submission: { accepts: [] } },
    { id: 'n', type: 'next_step', title: 'x', target: { kind: 'url', url: 'http://insecure' } },
    { id: 's', type: 'stepper', steps: [] },
  ])('rejects %j', (b) => expect(LessonBlockSchema.safeParse(b).success).toBe(false));

  it('type lists', () => {
    expect(ACTIVITY_BLOCK_TYPES).toEqual(['quiz', 'assignment', 'reflection', 'flashcards', 'accordion', 'tabs', 'reveal', 'stepper', 'resource_link', 'opportunity_link', 'next_step']);
    expect(CONTAINER_BLOCK_TYPES).toEqual(['callout', 'accordion', 'tabs', 'reveal', 'stepper']);
    expect(LESSON_BLOCK_TYPES).toHaveLength(26);
  });
});

describe('lesson document', () => {
  const doc = { schemaVersion: 1, kind: 'lesson', id: 'what-is-ai', title: { vi: 'AI là gì?', en: 'What is AI?' }, objectives: ['Define AI'], estimatedMinutes: 20, completion: { mode: 'activities' }, blocks: [p('Intro'), { id: 'quiz-1', type: 'quiz', questions: [sc] }] };
  it('accepts', () => expect(LessonDocumentSchema.safeParse(doc).success).toBe(true));
  it('rejects wrong kind, missing blocks, schemaVersion 2', () => {
    expect(LessonDocumentSchema.safeParse({ ...doc, kind: 'exam' }).success).toBe(false);
    expect(LessonDocumentSchema.safeParse({ ...doc, blocks: [] }).success).toBe(false);
    expect(LessonDocumentSchema.safeParse({ ...doc, schemaVersion: 2 }).success).toBe(false);
  });
});
