import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import { createMemoryExamClient } from './memory-client';
import {
  bankSource,
  compileExamFixtures,
  itemContext,
  learner,
  MutableClock,
} from './test-kit';

let exam: CompiledItem;

beforeAll(async () => {
  ({ ai: exam } = await compileExamFixtures());
});

describe('memory exam client', () => {
  it('binds learner actions to the started attempt and exposes the server clock', async () => {
    const repo = new InMemoryExamRepo();
    const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
    const service = createExamService({
      repo,
      clock,
      bank: bankSource,
      loadItem: async () => itemContext(exam),
      isEnrolled: async () => true,
    });
    const client = createMemoryExamClient(
      service,
      learner,
      { courseId: 'ai-foundations', itemId: exam.id },
      clock,
    );

    expect(await client.serverNow()).toEqual(new Date('2026-09-02T00:00:00.000Z'));
    const started = await client.start();
    const firstQuestion = started.learner.sections
      .flatMap((section) => section.questions as { id: string }[])
      .find((question) => question.id);
    if (!firstQuestion) throw new Error('expected the compiled exam to contain a question');

    await client.save({ [firstQuestion.id]: 'a' });
    await client.events([{ type: 'focus_lost' }]);
    const submitted = await client.submit();
    const review = await client.review();

    expect(submitted.attemptId).toBe(started.attemptId);
    expect(review.answers[firstQuestion.id]).toBe('a');
    expect(repo.listEvents(started.attemptId)).toHaveLength(1);
  });
});
