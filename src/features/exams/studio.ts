import type { ExamAnswerRecord, ExamAttemptRecord } from './types';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function questionNode(value: unknown, questionId: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = questionNode(entry, questionId);
      if (found) return found;
    }
    return null;
  }
  const node = record(value);
  if (!node) return null;
  if (node.id === questionId && typeof node.type === 'string') return node;
  for (const entry of Object.values(node)) {
    const found = questionNode(entry, questionId);
    if (found) return found;
  }
  return null;
}

export function pendingManualQuestionsForAttempt(
  attempt: ExamAttemptRecord,
  answers: readonly ExamAnswerRecord[],
) {
  return answers.flatMap((answer) => {
    if (answer.result?.status !== 'pending_manual') return [];
    const grading = attempt.gradingSnapshot.questions[answer.questionId];
    const learner = questionNode(attempt.questionSet.learner, answer.questionId);
    if (!grading) return [];
    return [{
      questionId: answer.questionId,
      type: typeof learner?.type === 'string' ? learner.type : grading.type,
      ...(learner?.content !== undefined ? { content: structuredClone(learner.content) } : {}),
      answer: structuredClone(answer.answer),
      maxPoints: answer.result.maxPoints,
      points: answer.manualPoints,
      feedback: structuredClone(answer.manualFeedback),
    }];
  });
}
