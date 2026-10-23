import { describe, it, expect } from 'vitest';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { CompiledItem } from '@/content-engine/compile';
import type { RichContent } from '@/content-engine/schema/types';

// Return type annotated so `type: 'paragraph'` keeps its literal type (else it widens to string).
const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const item: CompiledItem = {
  id: 'l1', kind: 'lesson', checksum: 'x',
  renders: { vi: { kind: 'lesson', id: 'l1', title: 'L', blocks: [] }, en: { kind: 'lesson', id: 'l1', title: 'L', blocks: [] } },
  grading: {
    questions: { 'quiz-1/q1': { id: 'quiz-1/q1', type: 'single_choice', points: 1, settings: {}, interactionType: 'radio', selfAssessment: false, correctAnswer: 'a', explanation: { vi: rc('vì'), en: rc('because') } } },
    quizzes: { 'quiz-1': { mode: 'graded', attemptsAllowed: 2, feedback: 'after_submit', showExplanations: true, shuffleQuestions: false, required: true, passPercent: 50, questionIds: ['quiz-1/q1'] } },
    rubrics: {}, activities: [{ id: 'quiz-1', type: 'quiz', required: true }], lessonCompletionMode: 'activities',
  },
};

describe('createPreviewRuntime', () => {
  it('stores block state in memory', () => {
    const rt = createPreviewRuntime(item, 'en');
    rt.setBlockState('ref-1', { text: 'hi' });
    expect(rt.getBlockState('ref-1')).toEqual({ text: 'hi' });
    expect(rt.snapshot()).toEqual({ 'ref-1': { text: 'hi' } });
  });
  it('grades quizzes locally, reveals per settings and counts attempts', async () => {
    const rt = createPreviewRuntime(item, 'en');
    const r1 = await rt.submitQuiz('quiz-1', { 'quiz-1/q1': 'b' });
    expect(r1).toMatchObject({ percent: 0, passed: false, attemptsRemaining: 1, revealed: { correctAnswers: { 'quiz-1/q1': 'a' }, explanations: { 'quiz-1/q1': rc('because') } } });
    const r2 = await rt.submitQuiz('quiz-1', { 'quiz-1/q1': 'a' });
    expect(r2).toMatchObject({ percent: 100, passed: true, attemptsRemaining: 0 });
    await expect(rt.submitQuiz('quiz-1', {})).rejects.toThrow(/attempts/);
    expect(rt.getBlockState<{ completed: boolean }>('quiz-1')?.completed).toBe(true);
  });
  it('checkQuestion grades one question for practice mode', async () => {
    const rt = createPreviewRuntime(item, 'vi');
    expect(await rt.checkQuestion('quiz-1', 'quiz-1/q1', 'a')).toMatchObject({ status: 'correct' });
  });
  it('resolves media and hrefs without an app', () => {
    const rt = createPreviewRuntime(item, 'vi');
    expect(rt.resolveMedia({ url: 'https://x.y/a.png' })).toBe('https://x.y/a.png');
    expect(rt.resolveMedia({ assetId: 'asset_1' })).toBe('preview://asset/asset_1');
    expect(rt.hrefFor({ kind: 'lesson', id: 'l2' })).toBe('#lesson/l2');
  });
});
