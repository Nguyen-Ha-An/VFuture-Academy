import { describe, it, expect } from 'vitest';
import { gradeQuestion, gradeAll } from '@/content-engine/grading';
import { applyScoringPolicy } from '@/content-engine/grading/policy';
import type { GradingQuestion } from '@/content-engine/compile/project';

const gq = (over: Partial<GradingQuestion>): GradingQuestion => ({ id: 'q', type: 'single_choice', points: 1, settings: {}, interactionType: 'radio', selfAssessment: false, ...over });

describe('gradeQuestion dispatcher', () => {
  it('routes by type, handles selfAssessment, groups and unknown answers', () => {
    expect(gradeQuestion(gq({ correctAnswer: 'a' }), 'a').status).toBe('correct');
    expect(gradeQuestion(gq({ type: 'true_false', correctAnswer: true }), true).status).toBe('correct');
    expect(gradeQuestion(gq({ selfAssessment: true, type: 'short_answer' }), 'anything')).toMatchObject({ status: 'self_assessed', points: 0, maxPoints: 0 });
    expect(gradeQuestion(gq({ selfAssessment: true, type: 'short_answer' }), '')).toMatchObject({ status: 'incomplete', maxPoints: 0 });
    const group = gq({ id: 'g', type: 'question_group', points: 3, children: [gq({ id: 'g/c1', correctAnswer: 'a', parentId: 'g' }), gq({ id: 'g/c2', type: 'true_false', correctAnswer: false, parentId: 'g' }), gq({ id: 'g/c3', type: 'essay', points: 1, parentId: 'g' })] });
    const r = gradeQuestion(group, { 'g/c1': 'a', 'g/c2': true, 'g/c3': 'text' });
    expect(r).toMatchObject({ status: 'pending_manual', points: 1, maxPoints: 3 });
    expect(r.children?.map((c) => c.status)).toEqual(['correct', 'incorrect', 'pending_manual']);
    expect(gradeQuestion(gq({ ...group, children: group.children!.slice(0, 2), points: 2 }), { 'g/c1': 'a', 'g/c2': false }).status).toBe('correct');
    expect(gradeQuestion(gq({ ...group, children: group.children!.slice(0, 2), points: 2 }), { 'g/c1': 'a', 'g/c2': true }).status).toBe('partial');
  });
});

describe('gradeAll', () => {
  it('totals points, excludes self-assessed from max, flags pending manual', () => {
    const gqs = [gq({ id: 'a', correctAnswer: 'x', points: 2 }), gq({ id: 'b', type: 'essay', points: 5 }), gq({ id: 'c', type: 'short_answer', selfAssessment: true })];
    const r = gradeAll(gqs, { a: 'x', b: 'essay text', c: 'reflection' });
    expect(r).toMatchObject({ points: 2, maxPoints: 7, percent: 28.57, pendingManual: true });
    expect(gradeAll(gqs.slice(0, 1), {})).toMatchObject({ points: 0, maxPoints: 2, percent: 0, pendingManual: false });
  });
});

describe('applyScoringPolicy', () => {
  it('best/latest/first/average', () => {
    const p = [40, 90, 70];
    expect(applyScoringPolicy('best', p)).toBe(90);
    expect(applyScoringPolicy('latest', p)).toBe(70);
    expect(applyScoringPolicy('first', p)).toBe(40);
    expect(applyScoringPolicy('average', p)).toBe(66.67);
    expect(applyScoringPolicy('best', [])).toBe(0);
  });
});
