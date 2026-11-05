import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ binding: null as Record<string, unknown> | null, selfAssessment: true }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => ({ from: (table: string) => {
  const data = () => table === 'course_version_item_renders' ? [{ locale: 'en', payload: { blocks: [{ id: 'quiz', type: 'quiz', questions: [{ id: 'group', type: 'question_group', questions: [{ id: 'group/upload', type: 'upload_answer', selfAssessment: state.selfAssessment, accepts: ['file', 'text'], maxFiles: 1, maxFileSizeMB: 1, allowedMimeTypes: ['application/pdf'] }] }] }] } }] : state.binding;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: data(), error: null }), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve) };
  return query;
} }) }));
import { validateQuizAnswerAttachments } from '@/features/quizzes/attachments';
import type { QuizAttachmentContext } from '@/features/quizzes/service';
const actor = { id: 'learner', locale: 'en' as const };
const context = { courseVersionId: 'version', courseId: 'course', itemId: 'lesson', quizId: 'quiz', grading: {} } as unknown as QuizAttachmentContext;
const file = { assetId: 'asset-1', name: 'work.pdf', size: 8, mime: 'application/pdf' };
const answer = { group: { 'group/upload': { files: [file] } } };
describe('self-assessed quiz attachment binding', () => {
  beforeEach(() => { state.selfAssessment = true; state.binding = { asset_id: 'asset-1', owner_id: 'learner', course_version_id: 'version', item_id: 'lesson', quiz_id: 'quiz', root_question_id: 'group', question_id: 'group/upload', filename: 'work.pdf', size_bytes: 8, mime: 'application/pdf' }; });
  it('accepts the exact owner and pinned group/question binding', async () => { await expect(validateQuizAnswerAttachments(actor, context, answer)).resolves.toBeUndefined(); });
  it('validates a group child directly for per-question checks, with and without a file', async () => {
    await expect(validateQuizAnswerAttachments(actor, context, { 'group/upload': { files: [file] } })).resolves.toBeUndefined();
    await expect(validateQuizAnswerAttachments(actor, context, { 'group/upload': { text: 'Reflection' } })).resolves.toBeUndefined();
  });
  it.each(['owner_id', 'course_version_id', 'item_id', 'quiz_id', 'root_question_id', 'question_id'])('rejects a foreign %s', async field => {
    state.binding![field] = 'foreign';
    await expect(validateQuizAnswerAttachments(actor, context, answer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('denies uploads for a manually graded question and forged metadata', async () => {
    state.selfAssessment = false;
    await expect(validateQuizAnswerAttachments(actor, context, answer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.selfAssessment = true;
    await expect(validateQuizAnswerAttachments(actor, context, { group: { 'group/upload': { files: [{ ...file, size: 9 }] } } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
