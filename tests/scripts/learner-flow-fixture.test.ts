import { describe, expect, it } from 'vitest';

import { compileCourse, InMemoryResolver, parseWorkspace } from '@/content-engine';
import { learnerFlowWorkspace } from '../e2e/support/learner-flow-fixture';

describe('disposable learner-chain source', () => {
  it('parses and compiles the exact quiz, exam, assignment, and release fixture', async () => {
    const source = learnerFlowWorkspace('main-learner-chain-aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa');
    const parsed = parseWorkspace(source);
    const compiled = await compileCourse(source, new InMemoryResolver({}), { publish: true, locales: ['en'] });

    expect(parsed.parsed).toBeDefined();
    expect(compiled.ok, compiled.diagnostics.map((diagnostic) => diagnostic.code).join(', ')).toBe(true);
    expect(compiled.compiled?.courseId).toBe('main-learner-chain-aaaaaaaaaaaaaaaa');
    expect(compiled.compiled?.items).toMatchObject({
      'chain-lesson': { kind: 'lesson', renders: { en: expect.any(Object) } },
      'chain-exam': { kind: 'exam', grading: { exam: { attemptsAllowed: 1, passPercent: 100 } } },
      'chain-assignment': { kind: 'assignment', grading: { assignments: { 'chain-assignment': { passPoints: 3 } } } },
    });
  });
});
