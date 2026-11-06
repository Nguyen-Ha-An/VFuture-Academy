import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(async () => undefined) }));
import type { CompiledItem } from '@/content-engine/compile';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import { ExamError, type ExamActor, type ExamAttemptRecord, type ExamPermission } from '@/features/exams/types';
import { bankSource, compileExamFixtures, itemContext, learner, MutableClock } from './test-kit';

let item: CompiledItem;
beforeAll(async () => { item = (await compileExamFixtures()).all; });
const teacher: ExamActor = { id: 'teacher', locale: 'en', permissions: ['submission.grade', 'exam.release'], global: true };

async function fixture(authorizeStaffAttempt?: (actor: ExamActor, permission: ExamPermission, attempt: ExamAttemptRecord) => Promise<void>) {
  const repo = new InMemoryExamRepo();
  const service = createExamService({ repo, bank: bankSource, clock: new MutableClock(new Date('2026-09-02T00:00:00Z')),
    loadItem: async () => ({ ...itemContext(item), branchId: 'historical-school' }), isEnrolled: async () => true,
    authorizeStaffAttempt });
  const { attemptId } = await service.start(learner, 'course-one', item.id);
  await repo.updateAttempt(attemptId, { status: 'pending_manual', submittedAt: new Date('2026-09-02T00:10:00Z') });
  return { repo, service, attemptId };
}

describe('exam teaching enforcement boundary', () => {
  it.each(['read', 'draft', 'complete', 'release'] as const)('denies %s with coarse global operation rights but no assigned course', async operation => {
    const authorize = vi.fn(async () => { throw new ExamError('FORBIDDEN', 'Unassigned course'); });
    const { repo, service, attemptId } = await fixture(authorize);
    const before = await repo.getAttempt(attemptId);
    if (operation === 'release') {
      const result = await service.release(teacher, { attemptId });
      expect(result).toMatchObject({ released: [], skipped: { forbidden: 1 } });
    } else {
      const request = operation === 'read' ? service.review(teacher, attemptId)
        : operation === 'draft' ? service.manualGrade(teacher, attemptId, 's2/e2', 1, 'feedback')
          : service.completeGrading(teacher, attemptId);
      await expect(request).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(authorize).toHaveBeenCalledWith(teacher, operation === 'release' ? 'exam.release' : 'submission.grade',
      expect.objectContaining({ courseVersionId: `version-${item.id}`, branchId: 'historical-school' }));
    expect(await repo.getAttempt(attemptId)).toEqual(before);
    expect(await repo.listAnswers(attemptId)).toEqual([]);
  });

  it('fails closed if a composition forgets authoritative staff authorization while student access still works', async () => {
    const { service, attemptId } = await fixture();
    await expect(service.review(learner, attemptId)).resolves.toMatchObject({ attemptId });
    await expect(service.review(teacher, attemptId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.manualGrade(teacher, attemptId, 's2/e2', 1, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('checks the live assignment again on the next request and never falls back to a current learner school', async () => {
    let assigned = true;
    const authorize = vi.fn(async (_actor: ExamActor, _permission: ExamPermission, attempt: ExamAttemptRecord) => {
      if (!assigned || attempt.branchId !== 'historical-school') throw new ExamError('FORBIDDEN', 'Unassigned');
    });
    const { service, attemptId } = await fixture(authorize);
    await expect(service.review(teacher, attemptId)).resolves.toMatchObject({ attemptId });
    assigned = false;
    await expect(service.review(teacher, attemptId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('uses scoped release queries before aggregate release metadata is produced', async () => {
    const { repo, attemptId } = await fixture(async () => undefined);
    const scoped = vi.fn(async () => [await repo.getAttempt(attemptId) as ExamAttemptRecord]);
    const list = vi.spyOn(repo, 'listAttempts');
    const service = createExamService({ repo, bank: bankSource, clock: new MutableClock(new Date()),
      loadItem: async () => itemContext(item), isEnrolled: async () => true,
      authorizeStaffAttempt: async () => undefined, listStaffReleaseAttempts: scoped });
    await service.release(teacher, { courseVersionId: `version-${item.id}`, itemId: item.id });
    expect(scoped).toHaveBeenCalledWith(teacher, { courseVersionId: `version-${item.id}`, itemId: item.id });
    expect(list).not.toHaveBeenCalled();
  });
});
