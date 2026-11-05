import type { LessonRuntime } from '@/content-engine/render/runtime';
import { directUploadFile } from '@/features/media/direct-upload-client';

/** Adds the active attempt and selected root question to leaf upload requests. */
export function examUploadRuntime(runtime: LessonRuntime, context: { attemptId: string; rootQuestionId: string; onPendingChange?: (delta: 1 | -1) => void }): LessonRuntime {
  return {
    ...runtime,
    onAnswerUploadPending(delta) {
      context.onPendingChange?.(delta);
      runtime.onAnswerUploadPending?.(delta);
    },
    uploadFile(file, options) {
      if (!options?.questionId) return Promise.reject(new Error('Exam upload question is missing'));
      return directUploadFile(file, {
        purpose: 'submission', blockId: null,
        examAttemptId: context.attemptId, rootQuestionId: context.rootQuestionId, questionId: options.questionId,
      }, { signal: options.signal, onProgress: options.onProgress });
    },
  };
}
