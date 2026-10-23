import { describe, expect, it } from 'vitest';
import { checkAuthoringProfile, schemaForAuthoring, staticProfileContext } from '@/content-engine/authoring';

const context = staticProfileContext('mono');
const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const truth = (id: string, points = 1) => ({ id, type: 'true_false', points, content: rich('True?'), explanation: rich('Yes.'), correctAnswer: true });
const exam = (questions: unknown[]) => ({ schemaVersion: 1, kind: 'exam', id: 'exam-a', title: 'Exam', sections: [{ id: 'section-a', title: 'Section', questions }] });
const lesson = (blocks: unknown[]) => ({ schemaVersion: 1, kind: 'lesson', id: 'lesson-a', title: 'Lesson', blocks });
const paragraph = (id: string) => ({ id, type: 'paragraph', content: [{ text: 'Text' }] });

describe('authoring profile boundaries', () => {
  it('accepts positive points through 1000 and rejects both outside bounds', () => {
    const profile = schemaForAuthoring('exam', context);
    for (const points of [0.001, 1000]) expect(profile.safeParse(exam([truth('q-a', points)])).success, String(points)).toBe(true);
    for (const points of [0, -1, 1000.001]) expect(profile.safeParse(exam([truth('q-a', points)])).success, String(points)).toBe(false);
  });

  it('counts group children at the 50-leaf quiz limit', () => {
    const groups = (counts: number[]) => counts.map((count, groupIndex) => ({
      id: `group-${groupIndex}`, type: 'question_group', sharedContent: rich('Passage'),
      questions: Array.from({ length: count }, (_, index) => truth(`q-${groupIndex}-${index}`)),
    }));
    const block = (counts: number[]) => ({ id: 'quiz-a', type: 'quiz', settings: { mode: 'practice' }, questions: groups(counts) });
    expect(checkAuthoringProfile(lesson([block([20, 20, 10])]), null, context).ok).toBe(true);
    const over = checkAuthoringProfile(lesson([block([20, 20, 11])]), null, context);
    expect(over.errors.map((issue) => issue.code)).toContain('E_PROFILE_QUESTION_LIMIT');
  });

  it('counts group children at the 200-leaf exam limit', () => {
    const groups = (count: number) => Array.from({ length: count }, (_, groupIndex) => ({
      id: `group-${groupIndex}`, type: 'question_group', sharedContent: rich('Passage'),
      questions: Array.from({ length: 20 }, (_, index) => truth(`q-${groupIndex}-${index}`)),
    }));
    expect(checkAuthoringProfile(exam(groups(10)), null, context).ok).toBe(true);
    const over = checkAuthoringProfile(exam([...groups(10), truth('extra')]), null, context);
    expect(over.errors.map((issue) => issue.code)).toContain('E_PROFILE_QUESTION_LIMIT');
  });

  it('bounds lesson blocks and list nesting without recursive schemas', () => {
    const profile = schemaForAuthoring('lesson', context);
    expect(profile.safeParse(lesson(Array.from({ length: 400 }, (_, index) => paragraph(`p-${index}`)))).success).toBe(true);
    expect(profile.safeParse(lesson(Array.from({ length: 401 }, (_, index) => paragraph(`p-${index}`)))).success).toBe(false);
    const listItem = (depth: number): unknown => depth === 1
      ? { content: [{ text: 'Item' }] }
      : { content: [{ text: 'Item' }], items: [listItem(depth - 1)] };
    const list = (depth: number) => ({ id: 'list-a', type: 'list', ordered: false, items: [listItem(depth)] });
    expect(profile.safeParse(lesson([list(3)])).success).toBe(true);
    expect(profile.safeParse(lesson([list(4)])).success).toBe(false);
  });

  it('enforces positive criterion weights and reflection character caps', () => {
    const assignment = (maxPoints: number) => ({
      schemaVersion: 1, kind: 'assignment', id: 'assignment-a', title: 'Assignment',
      instructions: rich('Work'), submission: { accepts: ['text'] },
      rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints }] },
    });
    const assignmentProfile = schemaForAuthoring('assignment', context);
    expect(assignmentProfile.safeParse(assignment(100)).success).toBe(true);
    expect(assignmentProfile.safeParse(assignment(0)).success).toBe(false);
    const reflection = (minChars: number) => ({ id: 'reflection-a', type: 'reflection', prompt: rich('Reflect'), minChars });
    const lessonProfile = schemaForAuthoring('lesson', context);
    expect(lessonProfile.safeParse(lesson([reflection(20000)])).success).toBe(true);
    expect(lessonProfile.safeParse(lesson([reflection(20001)])).success).toBe(false);
  });
});
