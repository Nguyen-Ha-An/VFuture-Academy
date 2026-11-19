import { describe, expect, it } from 'vitest';
import { compileItem } from '@/content-engine/compile';
import { fixtureResolver } from '@/content-engine/fixtures';
import type { RichContent } from '@/content-engine/schema/types';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import { bankSource, itemContext, learner, MutableClock, otherLearner } from './test-kit';

const image = (assetId: string): RichContent => ({ blocks: [{ type: 'image', src: { assetId }, alt: 'Diagram' }] });
const releaseAt = '2026-10-02T12:00:00Z';

async function examMedia(showExplanations: 'on_release' | 'never' = 'on_release') {
  const clock = new MutableClock(new Date('2026-10-01T12:00:00Z'));
  const item = await compileItem({
    schemaVersion: 1, kind: 'exam', id: 'test', title: 'Exam',
    settings: { navigation: 'sequential', layout: 'one_per_page', review: { showScore: 'immediately', showCorrectAnswers: 'never', showExplanations, releaseAt } },
    sections: [{ id: 'section', title: 'Section', questions: ['first', 'second'].map((id) => ({
      id, type: 'true_false', content: image(id), explanation: image(`${id}-solution`), correctAnswer: true,
    })) }],
  }, fixtureResolver, ['en'], 'en');
  const service = createExamService({
    repo: new InMemoryExamRepo(), clock, bank: bankSource, loadItem: async () => itemContext(item), isEnrolled: async () => true,
  });
  const { attemptId } = await service.start(learner, 'course', item.id);
  return { attemptId, service, clock };
}

describe('media in the selected exam attempt', () => {
  it('uses the assigned page during the attempt and the released explanation in review', async () => {
    const { service, attemptId, clock } = await examMedia();
    const allowed = (id: string) => service.canReadMedia(learner, attemptId, id);
    await expect(allowed('first')).resolves.toBe(true);
    await expect(allowed('second')).resolves.toBe(false);
    await expect(allowed('first-solution')).resolves.toBe(false);
    await expect(service.canReadMedia(otherLearner, attemptId, 'first')).resolves.toBe(false);
    await service.save(learner, attemptId, { 'section/first': true });
    await service.advance(learner, attemptId, 0);
    await expect(allowed('second')).resolves.toBe(true);
    await expect(allowed('first')).resolves.toBe(false);
    await service.submit(learner, attemptId);
    await expect(allowed('first')).resolves.toBe(true);
    await expect(allowed('first-solution')).resolves.toBe(false);
    clock.set(releaseAt);
    await expect(allowed('first-solution')).resolves.toBe(true);
  });

  it('keeps a never-released explanation private after the scheduled release', async () => {
    const { service, attemptId, clock } = await examMedia('never');
    await service.submit(learner, attemptId);
    clock.set(releaseAt);
    await expect(service.canReadMedia(learner, attemptId, 'first-solution')).resolves.toBe(false);
  });
});
