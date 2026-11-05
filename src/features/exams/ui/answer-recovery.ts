import { canonicalAnswer, sameCanonicalAnswer } from '@/features/learning/answer-canonical';

export interface ExamAnswerRecovery {
  attemptId: string;
  attemptNo: number;
  answers: Record<string, unknown>;
  verified: boolean;
  storageUnavailable?: boolean;
}

export function isTerminalExamStatus(status: unknown): boolean {
  return typeof status === 'string' && ['submitted', 'submitted_late', 'pending_manual', 'graded', 'expired'].includes(status);
}

/** Call only with an authoritative, exact-attempt terminal answer snapshot.
 * A lost save acknowledgement is not evidence that the learner's response was excluded. */
export function differingOwnAnswers(local: Record<string, unknown>, accepted: Record<string, unknown>): Record<string, unknown> {
  const differing: Array<[string, unknown]> = [];
  for (const [id, answer] of Object.entries(local)) {
    const own = canonicalAnswer(answer);
    if (!sameCanonicalAnswer(own, accepted[id])) differing.push([id, own]);
  }
  return Object.fromEntries(differing);
}
