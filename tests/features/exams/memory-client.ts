import type {
  ExamReviewResult,
  ExamService,
  ExamStartResult,
  ExamSubmitResult,
} from '@/features/exams/service';
import type {
  Clock,
  ExamActor,
  ExamAnswerRecord,
  ExamEventInput,
} from '@/features/exams/types';
import type { ExamClient } from '@/features/exams/ui/client';

interface MemoryExamClientIds {
  courseId: string;
  itemId: string;
  attemptId?: string;
}

export function createMemoryExamClient(
  service: ExamService,
  actor: ExamActor,
  ids: MemoryExamClientIds,
  clock: Clock,
): ExamClient {
  let attemptId = ids.attemptId;
  const activeAttemptId = () => {
    if (!attemptId) throw new Error('ExamClient.start() must complete before attempt actions.');
    return attemptId;
  };

  return {
    async session() {
      const result = await service.session(actor, ids.courseId, ids.itemId);
      attemptId = result.attempt?.attemptId;
      return result;
    },
    async start(): Promise<ExamStartResult> {
      const result = await service.start(actor, ids.courseId, ids.itemId);
      attemptId = result.attemptId;
      return result;
    },
    save: (answers): Promise<ExamAnswerRecord[]> => service.save(actor, activeAttemptId(), answers),
    submit: (): Promise<ExamSubmitResult> => service.submit(actor, activeAttemptId()),
    review: (): Promise<ExamReviewResult> => service.review(actor, activeAttemptId()),
    events: (events: readonly ExamEventInput[]) => service.events(actor, activeAttemptId(), events),
    async serverNow() {
      return new Date(clock.now());
    },
  };
}
