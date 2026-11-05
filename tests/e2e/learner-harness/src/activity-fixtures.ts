/** Immutable published content + disposable local transports. These fixtures never call a backend. */
import type { LearnerItem } from '@/content-engine/compile';
import { normalizeExamSettings } from '@/content-engine/compile/normalize';
import type { AssignmentSessionResult, AssignmentLocator, AssignmentSubmitResult, UploadedFile } from '@/content-engine/render/assignment-contracts';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { Locale } from '@/content-engine/schema/common';
import type { RichContent } from '@/content-engine/schema/types';
import type { ExamClient } from '@/features/exams/ui/client';
import type { LearnerExam } from '@/features/exams/ui/types';
import type { ExamStartResult, ExamReviewResult } from '@/features/exams/service';
import type { ExamAnswerRecord } from '@/features/exams/types';
export const ASSIGNMENT_COURSE = 'assignment-course';
export const ASSIGNMENT_VERSION = 'assignment-fixture-published-v1';
const rich = (text: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const copy = (locale: Locale, en: string, vi: string) => locale === 'vi' ? vi : en;
export function publishedAssignment(locale: Locale, itemId = 'assignment'): LearnerItem {
  return { kind: 'assignment', id: itemId, title: copy(locale, 'Community research assignment', 'Bài tập nghiên cứu cộng đồng'),
    instructions: rich(copy(locale, 'Interview one participant about a technology decision. Submit the evidence and explain the trade-offs behind your recommendation.', 'Phỏng vấn một người về quyết định công nghệ. Nộp bằng chứng và giải thích các đánh đổi trong đề xuất của bạn.')),
    submission: { accepts: ['text', 'link', 'file'], maxFiles: 2, maxFileSizeMB: 10, allowedMimeTypes: ['text/plain', 'application/pdf'], linkHosts: ['example.com'] },
    rubric: { criteria: [{ id: 'evidence', name: copy(locale, 'Evidence', 'Bằng chứng'), maxPoints: 5 }, { id: 'reasoning', name: copy(locale, 'Reasoning', 'Lập luận'), maxPoints: 5 }] },
    resubmission: 'until_approved' };
}
export function publishedLesson(locale: Locale, id: string, title: string): LearnerItem {
  const paragraph = copy(locale, 'Practice using technology responsibly. Compare the evidence and explain what would change your decision.', 'Thực hành sử dụng công nghệ có trách nhiệm. So sánh bằng chứng và giải thích điều gì có thể thay đổi quyết định của bạn.');
  return { kind: 'lesson', id, title, completion: { mode: 'view' }, blocks: Array.from({ length: id === 'long' ? 25 : 5 }, (_, index) => ({ id: `paragraph-${index}`, ...rich(paragraph).blocks[0] })) };
}
export function assignmentSession(locator: AssignmentLocator, locale: Locale, state = 'draft', version: string = ASSIGNMENT_VERSION): AssignmentSessionResult {
  const isDraft = ['draft', 'unavailable', 'submit-error', 'submit-pending'].includes(state);
  const submittedStatus = state === 'feedback' ? 'changes_requested' : state === 'approved' ? 'approved' : state === 'in_review' ? 'in_review' : 'submitted';
  const submission: AssignmentSessionResult['submissions'][number] = {
    submissionId: 'fixture-submission-1', attemptNo: 1, status: submittedStatus,
    submittedAt: '2026-11-03T09:00:00Z', dueAtSnapshot: state === 'late' ? '2026-11-02T09:00:00Z' : null, late: state === 'late' ? true : null,
    payload: { text: copy(locale, 'I compared the participant’s observations and recorded the evidence for each option.', 'Tôi đã so sánh các quan sát của người tham gia và ghi lại bằng chứng cho từng phương án.') }, files: [],
    ...(['feedback', 'approved'].includes(state) ? { grade: { released: true as const, decision: submittedStatus as 'changes_requested' | 'approved', rubricScores: { evidence: 4, reasoning: 3 }, totalPoints: 7, maxPoints: 10, passed: state === 'approved',
      feedback: copy(locale, 'Support the recommendation with a clearer example from the interview.', 'Bổ sung một ví dụ rõ ràng hơn từ cuộc phỏng vấn để hỗ trợ đề xuất.'), gradedAt: '2026-11-04T09:00:00Z' } } : {}),
  };
  return { locator, courseVersionId: version, attemptsUsed: isDraft ? 0 : 1, submissions: isDraft ? [] : [submission],
    action: isDraft ? { allowed: true, kind: 'initial', expectedLatestSubmissionId: null, nextAttemptNo: 1 }
      : state === 'feedback' ? { allowed: true, kind: 'revision', expectedLatestSubmissionId: submission.submissionId, nextAttemptNo: 2 }
        : { allowed: false, reason: state === 'approved' ? 'approved' : 'awaiting_review' } };
}
export function createActivityRuntime(locale: Locale, initialSession?: AssignmentSessionResult, params = new URLSearchParams()): LessonRuntime {
  let session = initialSession; let submits = 0; let uploads = 0;
  const state = new Map<string, unknown>();
  const assignmentState = params.get('assignmentState') ?? 'draft';
  const unavailable = async (): Promise<never> => { throw new Error('This operation is outside the disposable activity fixture.'); };
  if (session && ['submit-error', 'submit-pending'].includes(assignmentState)) state.set(session.locator.blockId ?? session.locator.itemId, { status: 'draft', payload: { text: 'A local draft remains available after an unsuccessful submission.' } });
  return { mode: 'learner', locale, getBlockState: <T,>(id: string) => state.get(id) as T | undefined, setBlockState: (id, value) => { state.set(id, value); },
    checkQuestion: unavailable, submitQuiz: unavailable,
    getAssignmentSession: () => assignmentState === 'unavailable' ? undefined : session,
    refreshAssignmentSession: async () => { if (!session) throw new Error('No assignment fixture session'); return session; },
    async submitAssignment(_target, payload, expectedLatestSubmissionId) {
      if (!session) throw new Error('No assignment fixture session');
      submits += 1;
      if (assignmentState === 'submit-error' && submits === 1) throw new Error('Disposable submit failure');
      if (assignmentState === 'submit-pending') return new Promise<AssignmentSubmitResult>(() => {});
      if ((session.submissions[0]?.submissionId ?? null) !== expectedLatestSubmissionId) throw Object.assign(new Error('Stale submission'), { code: 'SUBMISSION_STALE' });
      const nextAttempt = session.attemptsUsed + 1;
      session = { ...session, attemptsUsed: nextAttempt, submissions: [{ submissionId: `fixture-submission-${nextAttempt}`, attemptNo: nextAttempt, status: 'submitted', submittedAt: new Date().toISOString(), dueAtSnapshot: null, late: null, payload, files: payload.files ?? [] }, ...session.submissions], action: { allowed: false, reason: 'awaiting_review' } };
      return { created: true, session };
    },
    async uploadAssignmentFile(_target, file, options) {
      uploads += 1;
      options?.onProgress?.({ loaded: Math.round(file.size / 4), total: file.size, percent: 25 });
      if (params.get('upload') === 'pending') return new Promise<UploadedFile>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { code: 'UPLOAD_CANCELLED' })), { once: true }); });
      if (params.get('upload') === 'error' && uploads === 1) throw new Error('Disposable upload failure');
      options?.onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
      return { assetId: `fixture-file-${uploads}`, name: file.name, size: file.size, mime: file.type };
    },
    uploadFile: unavailable, resolveMedia: () => 'data:text/plain,Disposable%20fixture%20file', hrefFor: () => '/app', markViewed() {}, onActivityComplete() {},
  };
}
export function publishedExam(locale: Locale): LearnerExam {
  const prompt = copy(locale, 'Which value resists outliers?', 'Giá trị nào ít bị ảnh hưởng bởi ngoại lệ?');
  return { kind: 'exam', id: 'exam', title: copy(locale, 'Module exam', 'Bài thi học phần'), settings: normalizeExamSettings({ layout: 'one_per_page', attemptsAllowed: 2 } as never),
    sections: [{ id: 's1', title: copy(locale, 'Part 1', 'Phần 1'), questions: [
      { id: 'q1', type: 'single_choice', content: { blocks: [rich(prompt).blocks[0], ...Array.from({ length: 20 }, () => rich(copy(locale, 'Review the observations and explain how unusually large values affect each summary measure before choosing your answer.', 'Xem lại các quan sát và giải thích tác động của các giá trị bất thường trước khi chọn đáp án.')).blocks[0])] }, points: 1, options: [{ id: 'median', content: rich('Median') }, { id: 'mean', content: rich('Mean') }] },
      { id: 'q2', type: 'single_choice', content: rich(copy(locale, 'Which value is the most frequent?', 'Giá trị nào xuất hiện nhiều nhất?')), points: 1, options: [{ id: 'mode', content: rich('Mode') }, { id: 'range', content: rich('Range') }] },
    ] }] } as LearnerExam;
}
export function createFixtureExamClient(exam: LearnerExam, phase = 'active'): ExamClient {
  const now = new Date(); let saves: Record<string, unknown> = phase === 'review' ? { q1: 'median', q2: 'range' } : {};
  let sessionReads = 0; let starts = 0; let submits = 0;
  let attempt: ExamStartResult | null = phase === 'intro' || phase === 'start-error' ? null : { attemptId: `fixture-exam-${phase}`, attemptNo: 1, status: ['review', 'unreleased', 'review-error'].includes(phase) ? phase === 'unreleased' ? 'pending_manual' : 'graded' : 'in_progress', late: false,
    startedAt: now, deadlineAt: new Date(now.getTime() + 30 * 60000), sectionDeadlines: {}, answers: saves, learner: { sections: exam.sections as unknown as Record<string, unknown>[] } };
  const active = (): ExamStartResult => { if (!attempt) throw new Error('No local attempt'); return attempt; };
  return {
    async session() { sessionReads += 1; if (phase === 'restore-error' && sessionReads === 1) throw new Error('Disposable restore failure'); return { attemptsUsed: attempt?.attemptNo ?? 0, attempt }; },
    async start() { starts += 1; if (phase === 'start-error' && starts === 1) throw new Error('Disposable start failure'); const attemptNo = (attempt?.attemptNo ?? 0) + 1; attempt = { attemptId: `fixture-exam-start-${attemptNo}`, attemptNo, status: 'in_progress', late: false, startedAt: new Date(), deadlineAt: new Date(Date.now() + 30 * 60000), sectionDeadlines: {}, answers: {}, learner: { sections: exam.sections as unknown as Record<string, unknown>[] } }; return attempt; },
    async save(answers): Promise<ExamAnswerRecord[]> {
      saves = { ...saves, ...structuredClone(answers) };
      const current = active();
      current.answers = structuredClone(saves);
      // The real autosave hook replaces its acknowledged map from this complete DTO set.
      return Object.entries(saves).map(([questionId, answer]) => ({ attemptId: current.attemptId, questionId, answer: structuredClone(answer),
        result: null, manualPoints: null, manualFeedback: null, gradedBy: null, updatedAt: new Date() }));
    },
    async submit() { submits += 1; if (phase === 'submit-error' && submits === 1) throw new Error('Disposable submit failure'); active().status = 'graded'; return { attemptId: active().attemptId, status: 'graded', late: false, points: 1, maxPoints: 2, percent: 50, passed: false }; },
    async review(): Promise<ExamReviewResult> { if (phase === 'review-error') throw new Error('Disposable review failure'); return { attemptId: active().attemptId, status: active().status, late: false, released: false, resultsAvailable: phase !== 'unreleased', answers: saves, revealed: {}, ...(phase !== 'unreleased' ? { score: { points: 1, maxPoints: 2, percent: 50 }, results: [{ questionId: 'q1', points: 1, maxPoints: 1, status: 'correct' }, { questionId: 'q2', points: 0, maxPoints: 1, status: 'incorrect' }] } : {}) }; },
    events: async () => ({ accepted: 0, dropped: 0 }), serverNow: async () => new Date(),
  };
}
