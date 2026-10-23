import type { Locale, MediaRef } from '../schema/common';
import type { RichContent, NextStepTarget } from '../schema/types';
import type { QuestionResult } from '../grading/types';
import type { AssignmentPayload, AssignmentSessionResult, AssignmentSubmitResult, AssignmentTarget, UploadedFile, UploadProgress } from './assignment-contracts';
export type { AssignmentPayload, UploadedFile, UploadProgress } from './assignment-contracts';

export interface RevealedInfo { correctAnswers?: Record<string, unknown>; explanations?: Record<string, RichContent>; optionFeedback?: Record<string, Record<string, RichContent>> }
export interface QuizSubmitResult { attemptId: string; results: QuestionResult[]; points: number; maxPoints: number; percent: number; passed?: boolean; attemptsRemaining: number | null; revealed: RevealedInfo }

export interface LessonRuntime {
  mode: 'preview' | 'learner';
  locale: Locale;
  getBlockState<T>(blockId: string): T | undefined;
  setBlockState<T>(blockId: string, state: T): void;
  submitQuiz(quizId: string, answers: Record<string, unknown>): Promise<QuizSubmitResult>;
  checkQuestion(quizId: string, questionId: string, answer: unknown): Promise<QuestionResult & { revealed: RevealedInfo }>;
  getAssignmentSession(target: AssignmentTarget): AssignmentSessionResult | undefined;
  refreshAssignmentSession(target: AssignmentTarget): Promise<AssignmentSessionResult>;
  submitAssignment(target: AssignmentTarget, payload: AssignmentPayload, expectedLatestSubmissionId: string | null): Promise<AssignmentSubmitResult>;
  uploadAssignmentFile(target: AssignmentTarget, file: File, options?: { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void }): Promise<UploadedFile>;
  uploadFile(file: File): Promise<UploadedFile>;
  resolveMedia(ref: MediaRef): string;
  hrefFor(target: NextStepTarget | { kind: 'resource' | 'opportunity'; id: string }): string;
  notebookHref?(target: AssignmentTarget): string;
  markViewed(): void;
  onActivityComplete(blockId: string): void;
}
