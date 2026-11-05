import 'server-only';

import { ApiError } from '@/lib/api';
import { supabaseService } from '@/lib/supabase/server';
import { assertEnrollmentMembershipAccess, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { allowedSubmissionUrl } from '@/content-engine/render/assignment-contracts';
import { SupabaseExamRepo } from './supabase-repo';
import type { ExamActor, ExamAttemptRecord } from './types';

type Row = Record<string, unknown>;
type ExamUploadContext = { courseId?: string; itemId?: string; examAttemptId: string; rootQuestionId: string; questionId: string; size: number; mime: string };
const object = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.flatMap(item => { const row = object(item); return row ? [row] : []; }) : [];
const invalid = (): never => { throw new ApiError(403, 'FORBIDDEN', 'Exam attachment is not available'); };
function containsFiles(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFiles);
  const entry = object(value);
  return !!entry && Object.entries(entry).some(([key, child]) => key === 'files' && Array.isArray(child) && child.length > 0 || containsFiles(child));
}

/** Find only a selected top-level question and its explicitly pinned group descendants. */
function selectedQuestion(attempt: ExamAttemptRecord, rootId: string, questionId: string): Row | null {
  const section = attempt.questionSet.sections.find(entry => entry.questionIds.includes(rootId));
  if (!section) return null;
  const learner = object(attempt.questionSet.learner);
  const sourceSection = rows(learner?.sections).find(entry => entry.id === section.id);
  const root = rows(sourceSection?.questions).find(entry => entry.id === rootId);
  if (!root) return null;
  const find = (question: Row): Row | null => {
    if (question.id === questionId) return question;
    if (question.type !== 'question_group') return null;
    for (const child of rows(question.questions)) { const found = find(child); if (found) return found; }
    return null;
  };
  return find(root);
}

function checkOpen(attempt: ExamAttemptRecord, rootId: string, now = new Date()) {
  if (attempt.status !== 'in_progress') throw new ApiError(409, 'ATTEMPT_NOT_ACTIVE', 'The exam attempt is no longer active');
  const grace = 30_000;
  if (attempt.deadlineAt && now.getTime() > attempt.deadlineAt.getTime() + grace) throw new ApiError(409, 'DEADLINE_PASSED', 'The exam deadline has passed');
  const section = attempt.questionSet.sections.find(entry => entry.questionIds.includes(rootId));
  if (!section) return invalid();
  if (section.deadlineOffsetMs !== null && now.getTime() > attempt.startedAt.getTime() + section.deadlineOffsetMs + grace) throw new ApiError(409, 'SECTION_DEADLINE_PASSED', 'The section deadline has passed');
}

/** Recheck ownership, enrollment/membership, pinned question and limits before a new permit. */
export async function authorizeExamUpload(owner: string, input: ExamUploadContext) {
  const database = supabaseService();
  const attempt = await new SupabaseExamRepo().getAttempt(input.examAttemptId);
  if (!attempt || attempt.userId !== owner || input.itemId && attempt.itemId !== input.itemId) return invalid();
  checkOpen(attempt, input.rootQuestionId);
  const enrollment = await database.from('enrollments').select('course_version_id,course_id,branch_id,branch_scope_known').eq('user_id', owner).eq('course_version_id', attempt.courseVersionId).in('status', ['active', 'completed']).maybeSingle();
  if (enrollment.error) throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Exam enrollment could not be checked');
  if (!enrollment.data || typeof enrollment.data.course_id !== 'string' || input.courseId && enrollment.data.course_id !== input.courseId) return invalid();
  await assertEnrollmentMembershipAccess({ userId: owner, roles: [] }, enrollment.data, database as unknown as MembershipAccessDatabase);
  // A moved enrollment never substitutes its current school for the
  // attempt's recorded school. Unknown historical school stays unknown.
  if (attempt.branchId && (enrollment.data.branch_scope_known !== true || enrollment.data.branch_id !== attempt.branchId)) {
    await assertEnrollmentMembershipAccess({ userId: owner, roles: [] }, { branch_scope_known: true, branch_id: attempt.branchId }, database as unknown as MembershipAccessDatabase);
  }
  const question = selectedQuestion(attempt, input.rootQuestionId, input.questionId);
  if (!question || question.type !== 'upload_answer' || !Array.isArray(question.accepts) || !question.accepts.includes('file')) return invalid();
  const maxMB = typeof question.maxFileSizeMB === 'number' ? question.maxFileSizeMB : 20;
  if (input.size > maxMB * 1024 * 1024) throw new ApiError(400, 'FILE_TOO_LARGE', 'File exceeds the question limit');
  if (Array.isArray(question.allowedMimeTypes) && question.allowedMimeTypes.length && !question.allowedMimeTypes.includes(input.mime)) throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'File type is not allowed for this question');
  return { courseId: enrollment.data.course_id, itemId: attempt.itemId };
}

/** Validate the pinned answer tree; database binding enforcement remains mandatory at commit. */
export async function validateExamAnswerAttachments(actor: ExamActor, attempt: ExamAttemptRecord, answers: Record<string, unknown>) {
  if (attempt.userId !== actor.id) return invalid();
  const database = supabaseService();
  const validate = async (rootId: string, question: Row, value: unknown): Promise<void> => {
    const answer = object(value);
    if (!answer) return;
    if (question.type === 'question_group') {
      const children = rows(question.questions);
      for (const [id, childAnswer] of Object.entries(answer)) {
        const child = children.find(entry => entry.id === id);
        if (!child) { if (containsFiles(childAnswer)) return invalid(); continue; }
        await validate(rootId, child, childAnswer);
      }
      return;
    }
    if (question.type !== 'upload_answer') { if (containsFiles(value)) return invalid(); return; }
    const accepts = Array.isArray(question.accepts) ? question.accepts : [];
    if (answer.text !== undefined && (typeof answer.text !== 'string' || (answer.text.length > 0 && !accepts.includes('text')))) return invalid();
    if (answer.links !== undefined) {
      if (!Array.isArray(answer.links) || (answer.links.length > 0 && !accepts.includes('link'))) return invalid();
      const hosts = Array.isArray(question.linkHosts) ? question.linkHosts.filter((host): host is string => typeof host === 'string') : undefined;
      for (const linkValue of answer.links) {
        const link = object(linkValue);
        if (!link || typeof link.url !== 'string' || !allowedSubmissionUrl(link.url, hosts)) return invalid();
      }
    }
    const files = answer.files;
    if (files === undefined) return;
    if (!Array.isArray(files) || files.length > (typeof question.maxFiles === 'number' ? question.maxFiles : 3)) return invalid();
    if (files.length && (!Array.isArray(question.accepts) || !question.accepts.includes('file'))) return invalid();
    const seen = new Set<string>();
    for (const value of files) {
      const file = object(value);
      if (!file || typeof file.assetId !== 'string' || seen.has(file.assetId)) return invalid();
      seen.add(file.assetId);
      const binding = await database.from('exam_attachment_bindings').select('asset_id,owner_id,attempt_id,root_question_id,question_id,filename,size_bytes,mime').eq('asset_id', file.assetId).maybeSingle();
      if (binding.error) throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Exam attachment could not be checked');
      const row = object(binding.data);
      if (!row || row.owner_id !== actor.id || row.attempt_id !== attempt.id || row.root_question_id !== rootId || row.question_id !== question.id || row.filename !== file.name || Number(row.size_bytes) !== file.size || row.mime !== file.mime) return invalid();
      if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (typeof question.maxFileSizeMB === 'number' ? question.maxFileSizeMB : 20) * 1024 * 1024) return invalid();
      if (Array.isArray(question.allowedMimeTypes) && question.allowedMimeTypes.length && !question.allowedMimeTypes.includes(file.mime)) return invalid();
    }
  };
  for (const [rootId, answer] of Object.entries(answers)) {
    const root = selectedQuestion(attempt, rootId, rootId);
    if (!root) return invalid();
    await validate(rootId, root, answer);
  }
}
