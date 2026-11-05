import 'server-only';
import { ApiError } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { assertEnrollmentMembershipAccess, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { allowedSubmissionUrl } from '@/content-engine/render/assignment-contracts';
import type { QuizActor, QuizAttachmentContext } from './service';

type Row = Record<string, unknown>;
const object = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.flatMap(value => { const row = object(value); return row ? [row] : []; }) : [];
const deny = (): never => { throw new ApiError(403, 'FORBIDDEN', 'Quiz attachment is not available'); };
function hasFiles(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFiles);
  const row = object(value);
  return !!row && Object.entries(row).some(([key, child]) => key === 'files' && Array.isArray(child) && child.length > 0 || hasFiles(child));
}
function findQuiz(value: unknown, id: string): Row | null {
  const entry = object(value);
  if (!entry) return null;
  if (entry.type === 'quiz' && entry.id === id) return entry;
  for (const field of ['blocks', 'items', 'steps']) for (const child of rows(entry[field])) { const found = findQuiz(child, id); if (found) return found; }
  return null;
}
function findQuestion(root: Row, id: string): Row | null {
  if (root.id === id) return root;
  if (root.type !== 'question_group') return null;
  for (const child of rows(root.questions)) { const found = findQuestion(child, id); if (found) return found; }
  return null;
}
async function pinnedQuiz(versionId: string, itemId: string, quizId: string): Promise<Row> {
  const database = supabaseService();
  const result = await database.from('course_version_item_renders').select('locale,payload').eq('version_id', versionId).eq('item_id', itemId);
  if (result.error) throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Published quiz could not be checked');
  const rendered = rows(result.data).sort((a, b) => String(a.locale).localeCompare(String(b.locale)));
  for (const row of rendered) { const quiz = findQuiz(row.payload, quizId); if (quiz) return quiz; }
  return deny();
}
type QuizUpload = { courseId: string; itemId: string; quizId: string; rootQuestionId: string; questionId: string; courseVersionId?: string; size: number; mime: string };
export async function authorizeQuizUpload(owner: string, input: QuizUpload) {
  const database = supabaseService();
  const enrollment = await database.from('enrollments').select('course_version_id,branch_id,branch_scope_known').eq('user_id', owner).eq('course_id', input.courseId).in('status', ['active', 'completed']).maybeSingle();
  if (enrollment.error) throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Quiz enrollment could not be checked');
  if (!enrollment.data || typeof enrollment.data.course_version_id !== 'string' || input.courseVersionId && enrollment.data.course_version_id !== input.courseVersionId) return deny();
  await assertEnrollmentMembershipAccess({ userId: owner, roles: [] }, enrollment.data, database as unknown as MembershipAccessDatabase);
  const quiz = await pinnedQuiz(enrollment.data.course_version_id, input.itemId, input.quizId);
  const root = rows(quiz.questions).find(question => question.id === input.rootQuestionId);
  const question = root && findQuestion(root, input.questionId);
  if (!question || question.type !== 'upload_answer' || question.selfAssessment !== true || !Array.isArray(question.accepts) || !question.accepts.includes('file')) return deny();
  if (input.size > (typeof question.maxFileSizeMB === 'number' ? question.maxFileSizeMB : 20) * 1024 * 1024) throw new ApiError(400, 'FILE_TOO_LARGE', 'File exceeds the question limit');
  if (Array.isArray(question.allowedMimeTypes) && question.allowedMimeTypes.length && !question.allowedMimeTypes.includes(input.mime)) throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'File type is not allowed for this question');
  return { courseVersionId: enrollment.data.course_version_id };
}

export async function validateQuizAnswerAttachments(actor: QuizActor, context: QuizAttachmentContext, answers: Record<string, unknown>) {
  const quiz = await pinnedQuiz(context.courseVersionId, context.itemId, context.quizId);
  const database = supabaseService();
  const validate = async (rootId: string, question: Row, value: unknown): Promise<void> => {
    const answer = object(value); if (!answer) return;
    if (question.type === 'question_group') {
      const children = rows(question.questions);
      for (const [id, childAnswer] of Object.entries(answer)) { const child = children.find(q => q.id === id); if (child) await validate(rootId, child, childAnswer); else if (hasFiles(childAnswer)) return deny(); }
      return;
    }
    if (question.type !== 'upload_answer') { if (hasFiles(value)) return deny(); return; }
    const accepts = Array.isArray(question.accepts) ? question.accepts : [];
    if (answer.text !== undefined && (typeof answer.text !== 'string' || answer.text.length > 0 && !accepts.includes('text'))) return deny();
    if (answer.links !== undefined) {
      if (!Array.isArray(answer.links) || answer.links.length > 0 && !accepts.includes('link')) return deny();
      const hosts = Array.isArray(question.linkHosts) ? question.linkHosts.filter((host): host is string => typeof host === 'string') : undefined;
      for (const value of answer.links) { const link = object(value); if (!link || typeof link.url !== 'string' || !allowedSubmissionUrl(link.url, hosts)) return deny(); }
    }
    if (answer.files === undefined) return;
    if (!Array.isArray(answer.files) || answer.files.length > (typeof question.maxFiles === 'number' ? question.maxFiles : 3) || answer.files.length > 0 && (!accepts.includes('file') || question.selfAssessment !== true)) return deny();
    const seen = new Set<string>();
    for (const value of answer.files) {
      const file = object(value); if (!file || typeof file.assetId !== 'string' || seen.has(file.assetId)) return deny();
      seen.add(file.assetId);
      const result = await database.from('quiz_attachment_bindings').select('asset_id,owner_id,course_version_id,item_id,quiz_id,root_question_id,question_id,filename,size_bytes,mime').eq('asset_id',file.assetId).maybeSingle();
      if (result.error) throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Quiz attachment could not be checked');
      const row = object(result.data);
      if (!row || row.owner_id !== actor.id || row.course_version_id !== context.courseVersionId || row.item_id !== context.itemId || row.quiz_id !== context.quizId || row.root_question_id !== rootId || row.question_id !== question.id || row.filename !== file.name || Number(row.size_bytes) !== file.size || row.mime !== file.mime) return deny();
      if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (typeof question.maxFileSizeMB === 'number' ? question.maxFileSizeMB : 20) * 1024 * 1024) return deny();
      if (Array.isArray(question.allowedMimeTypes) && question.allowedMimeTypes.length && !question.allowedMimeTypes.includes(file.mime)) return deny();
    }
  };
  for (const [rootId, answer] of Object.entries(answers)) {
    const root = rows(quiz.questions).find(question => findQuestion(question, rootId));
    const selected = root && findQuestion(root, rootId);
    if (!root || typeof root.id !== 'string' || !selected) return deny();
    await validate(root.id, selected, answer);
  }
}
