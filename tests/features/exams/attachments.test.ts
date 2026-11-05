import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ binding: null as Record<string, unknown> | null, attempt: null as unknown, enrollment: null as Record<string, unknown> | null, membership: null as Record<string, unknown> | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, in: () => query, maybeSingle: async () => ({ data: table === 'enrollments' ? state.enrollment : table === 'branch_memberships' ? state.membership : state.binding, error: null }) };
  return query;
} }) }));
vi.mock('@/features/exams/supabase-repo', () => ({ SupabaseExamRepo: class { async getAttempt() { return state.attempt; } } }));
import { authorizeExamUpload, validateExamAnswerAttachments } from '@/features/exams/attachments';
import type { ExamAttemptRecord, ExamActor } from '@/features/exams/types';

const actor: ExamActor = { id: 'learner', locale: 'en' };
const question = { id: 'upload-q', type: 'upload_answer', accepts: ['file', 'link', 'text'], maxFiles: 1, maxFileSizeMB: 1, allowedMimeTypes: ['application/pdf'], linkHosts: ['example.org'] };
const attempt = { id: 'attempt', userId: 'learner', questionSet: { sections: [{ id: 'section', questionIds: ['group-q'], deadlineOffsetMs: null }], learner: { sections: [{ id: 'section', questions: [{ id: 'group-q', type: 'question_group', questions: [question] }] }] } } } as unknown as ExamAttemptRecord;
const file = { assetId: 'asset-1', name: 'work.pdf', size: 8, mime: 'application/pdf' };
const answer = (files: unknown[] = [file]) => ({ 'group-q': { 'upload-q': { files } } });

describe('exam attachment save admission', () => {
  beforeEach(() => { state.binding = { asset_id: 'asset-1', owner_id: 'learner', attempt_id: 'attempt', root_question_id: 'group-q', question_id: 'upload-q', filename: 'work.pdf', size_bytes: 8, mime: 'application/pdf' }; });
  it('accepts the exact ready binding in its pinned grouped question', async () => {
    await expect(validateExamAnswerAttachments(actor, attempt, answer())).resolves.toBeUndefined();
  });
  it.each(['owner_id', 'attempt_id', 'root_question_id', 'question_id'])('rejects a foreign %s binding', async (field) => {
    state.binding![field] = 'other';
    await expect(validateExamAnswerAttachments(actor, attempt, answer())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects unbound assets and changed file metadata', async () => {
    state.binding = null;
    await expect(validateExamAnswerAttachments(actor, attempt, answer())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.binding = { asset_id: 'asset-1', owner_id: 'learner', attempt_id: 'attempt', root_question_id: 'group-q', question_id: 'upload-q', filename: 'work.pdf', size_bytes: 8, mime: 'application/pdf' };
    await expect(validateExamAnswerAttachments(actor, attempt, answer([{ ...file, size: 9 }]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('enforces count and link host from the pinned question', async () => {
    await expect(validateExamAnswerAttachments(actor, attempt, answer([file, file]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(validateExamAnswerAttachments(actor, attempt, { 'group-q': { 'upload-q': { links: [{ url: 'https://other.example/path' }] } } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('exam attachment reservation admission', () => {
  const input = { examAttemptId: 'attempt', rootQuestionId: 'group-q', questionId: 'upload-q', size: 8, mime: 'application/pdf' };
  beforeEach(() => {
    state.attempt = { ...attempt, status: 'in_progress', itemId: 'exam', courseVersionId: 'version', branchId: 'school', startedAt: new Date(Date.now() - 1000), deadlineAt: new Date(Date.now() + 60_000) };
    state.enrollment = { course_id: 'course', course_version_id: 'version', branch_scope_known: true, branch_id: 'school' };
    state.membership = { status: 'active' };
  });
  it('derives course and item from the owned active pinned attempt', async () => {
    await expect(authorizeExamUpload('learner', input)).resolves.toEqual({ courseId: 'course', itemId: 'exam' });
  });
  it('rejects foreign owners, questions and suspended enrollment membership', async () => {
    await expect(authorizeExamUpload('other', input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(authorizeExamUpload('learner', { ...input, questionId: 'foreign' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.membership = { status: 'suspended' };
    await expect(authorizeExamUpload('learner', input)).rejects.toMatchObject({ code: 'MEMBERSHIP_SUSPENDED' });
  });
  it('allows an owned pinned attempt when historical school is unknown', async () => {
    (state.attempt as ExamAttemptRecord).branchId = null;
    state.enrollment!.branch_scope_known = false; state.enrollment!.branch_id = null;
    await expect(authorizeExamUpload('learner', input)).resolves.toEqual({ courseId: 'course', itemId: 'exam' });
  });
  it('does not substitute a current enrollment school for a different recorded attempt school', async () => {
    state.enrollment!.branch_id = 'other';
    await expect(authorizeExamUpload('learner', input)).resolves.toEqual({ courseId: 'course', itemId: 'exam' });
  });
  it('blocks suspension at a known historical attempt school even when the enrollment school is unknown', async () => {
    state.enrollment!.branch_scope_known = false; state.enrollment!.branch_id = null;
    state.membership = { status: 'suspended' };
    await expect(authorizeExamUpload('learner', input)).rejects.toMatchObject({ code: 'MEMBERSHIP_SUSPENDED' });
  });
  it('enforces whole-attempt and section deadlines and question file restrictions', async () => {
    const current = state.attempt as ExamAttemptRecord;
    current.deadlineAt = new Date(Date.now() - 31_000);
    await expect(authorizeExamUpload('learner', input)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    current.deadlineAt = null; current.questionSet = structuredClone(current.questionSet);
    current.questionSet.sections[0].deadlineOffsetMs = 1;
    current.startedAt = new Date(Date.now() - 31_000);
    await expect(authorizeExamUpload('learner', input)).rejects.toMatchObject({ code: 'SECTION_DEADLINE_PASSED' });
    current.startedAt = new Date();
    await expect(authorizeExamUpload('learner', { ...input, mime: 'image/png' })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(authorizeExamUpload('learner', { ...input, size: 1_048_577 })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });
});
