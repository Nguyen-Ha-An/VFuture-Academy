import { describe, it, expect } from 'vitest';
import { gradeFillBlank } from '@/content-engine/grading/graders/fill-blank';
import { gradeMatching, gradeOrdering, gradeClassification } from '@/content-engine/grading/graders/structure';
import { gradeManual } from '@/content-engine/grading/graders/manual';
import type { GradingQuestion } from '@/content-engine/compile/project';

const gq = (over: Partial<GradingQuestion>): GradingQuestion => ({ id: 'q', type: 'fill_blank', points: 3, settings: { partialScoring: true }, interactionType: 'text', selfAssessment: false, ...over });

describe('fill_blank', () => {
  const q = gq({ correctAnswer: { b1: ['Hà Nội', 'Hanoi'], b2: 'Huế', b3: 'Đà Nẵng' } });
  it('per-blank normalized match with parts', () => {
    expect(gradeFillBlank(q, { b1: 'hanoi', b2: 'huế', b3: 'Đà Nẵng' })).toMatchObject({ status: 'correct', points: 3 });
    expect(gradeFillBlank(q, { b1: 'hanoi', b2: 'Hà Nội' })).toMatchObject({ status: 'partial', points: 1, parts: { b1: 'correct', b2: 'incorrect', b3: 'missing' } });
    expect(gradeFillBlank({ ...q, settings: {} }, { b1: 'hanoi', b2: 'Hà Nội', b3: 'x' }).status).toBe('incorrect');
    expect(gradeFillBlank(q, {}).status).toBe('incomplete');
    expect(gradeFillBlank(q, 'Hanoi').status).toBe('incomplete');
  });
  it('word_bank compares ids exactly', () => {
    const wb = gq({ interactionType: 'word_bank', correctAnswer: { b1: 'w1' } });
    expect(gradeFillBlank(wb, { b1: 'w1' }).status).toBe('correct');
    expect(gradeFillBlank(wb, { b1: 'W1' }).status).toBe('incorrect');
  });
});

describe('matching', () => {
  const q = gq({ type: 'matching', points: 2, correctAnswer: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r2' }] });
  it('edge-set grading with per-left parts', () => {
    expect(gradeMatching(q, [{ left: 'l2', right: 'r2' }, { left: 'l1', right: 'r1' }]).status).toBe('correct');
    expect(gradeMatching(q, [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r3' }])).toMatchObject({ status: 'partial', points: 1, parts: { l1: 'correct', l2: 'incorrect' } });
    expect(gradeMatching(q, [{ left: 'l1', right: 'r1' }])).toMatchObject({ parts: { l1: 'correct', l2: 'missing' } });
    expect(gradeMatching(q, 'nope').status).toBe('incomplete');
  });
  it('parts and score stay consistent (fix): extra right on a matched left is incorrect, not silently correct', () => {
    const single = gq({ type: 'matching', points: 1, correctAnswer: [{ left: 'l1', right: 'r1' }] });
    expect(gradeMatching(single, [{ left: 'l1', right: 'r1' }, { left: 'l1', right: 'r2' }])).toMatchObject({ status: 'incorrect', points: 0, parts: { l1: 'incorrect' } });
  });
  it('many-to-one key: each left graded independently off its own key edges', () => {
    const manyToOne = gq({ type: 'matching', points: 2, allowManyToOne: true, correctAnswer: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r1' }] });
    expect(gradeMatching(manyToOne, [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r1' }])).toMatchObject({ status: 'correct', points: 2, parts: { l1: 'correct', l2: 'correct' } });
  });
  it('unchanged: a left with no learner edge stays missing, not incorrect', () => {
    expect(gradeMatching(q, [{ left: 'l1', right: 'r1' }])).toMatchObject({ parts: { l1: 'correct', l2: 'missing' } });
  });
});

describe('ordering', () => {
  const q = gq({ type: 'ordering', points: 4, correctAnswer: ['a', 'b', 'c', 'd'] });
  it('positions matched / n', () => {
    expect(gradeOrdering(q, ['a', 'b', 'c', 'd']).status).toBe('correct');
    expect(gradeOrdering(q, ['a', 'c', 'b', 'd'])).toMatchObject({ status: 'partial', points: 2 });
    expect(gradeOrdering(q, ['d', 'c', 'b', 'a']).status).toBe('incorrect');
    expect(gradeOrdering(q, ['a', 'b']).status).toBe('partial');
    expect(gradeOrdering(q, []).status).toBe('incomplete');
  });
});

describe('classification', () => {
  const q = gq({ type: 'classification', points: 3, correctAnswer: { i1: 'c1', i2: 'c2', i3: 'c1' } });
  it('per item', () => {
    expect(gradeClassification(q, { i1: 'c1', i2: 'c2', i3: 'c1' }).status).toBe('correct');
    expect(gradeClassification(q, { i1: 'c1', i2: 'c1' })).toMatchObject({ status: 'partial', points: 1, parts: { i1: 'correct', i2: 'incorrect', i3: 'missing' } });
  });
});

describe('manual', () => {
  it('essay → pending_manual with rubric max; empty → incomplete; selfAssessment → self_assessed', () => {
    const essay = gq({ type: 'essay', points: 10, rubricMax: 10 });
    expect(gradeManual(essay, 'My answer')).toMatchObject({ status: 'pending_manual', points: 0, maxPoints: 10 });
    expect(gradeManual(essay, '').status).toBe('incomplete');
    expect(gradeManual(gq({ type: 'upload_answer', points: 5 }), { files: [{ assetId: 'a', name: 'f.pdf', size: 1, mime: 'application/pdf' }] }).status).toBe('pending_manual');
    expect(gradeManual(gq({ type: 'code_answer', points: 5 }), { code: 'print(1)', language: 'python' }).status).toBe('pending_manual');
  });
});
