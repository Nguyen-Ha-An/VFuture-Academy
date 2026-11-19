import 'server-only';

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import type { GradingItem, QuizGradingSettings } from '@/content-engine/compile';
import { LOCALES, type Locale } from '@/content-engine/schema/common';
import type { RevealedInfo } from '@/content-engine/render/runtime';
import { buildRevealed } from '@/content-engine/render/preview-runtime';
import { hasMediaEnrollment } from '@/features/media/access';
import { referencesAsset } from '@/features/media/references';
import { assertEnrollmentMembershipAccess, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { oneRecord, recordOf } from '@/features/learning/shared';
import { academyBackend } from '@/lib/identity/provider';
import type { Actor } from '@/lib/permissions';
import type { supabaseService } from '@/lib/supabase/server';

const receipt = /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-z0-9][a-z0-9-]{0,63}|)\.([A-Za-z0-9_-]{43})$/i;
type Database = Pick<ReturnType<typeof supabaseService>, 'from'>;

function signature(userId: string, versionId: string, branchId: string | null, assetId: string): Buffer {
  const key = academyBackend() === 'azure'
    ? Buffer.from(process.env.ENTRA_SESSION_ENCRYPTION_KEY ?? '', 'base64')
    : Buffer.from(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', 'utf8');
  if (key.length < 32) throw new Error('Quiz media authorization is unavailable');
  const mediaKey = Buffer.from(hkdfSync('sha256', key, '', 'academy-quiz-media-v1', 32));
  return createHmac('sha256', mediaKey).update(JSON.stringify([userId, versionId, branchId, assetId])).digest();
}

function mapMediaRefs(value: unknown, bind: (assetId: string) => unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => mapMediaRefs(entry, bind));
  const object = recordOf(value);
  if (!object) return value;
  if (typeof object.assetId === 'string' && Object.keys(object).length === 1) {
    return bind(object.assetId);
  }
  return Object.fromEntries(Object.entries(object).map(([key, nested]) => [key, mapMediaRefs(nested, bind)]));
}

/** A successful practice check can release one question without creating a quiz attempt.
 * The receipt survives a saved lesson and still requires this learner's live enrollment in the immutable version. */
export function bindQuizMedia(revealed: RevealedInfo, userId: string, versionId: string, branchId: string | null): RevealedInfo {
  return mapMediaRefs(revealed, (assetId) => ({
    assetId, quizMediaReceipt: `v1.${versionId}.${branchId ?? ''}.${signature(userId, versionId, branchId, assetId).toString('base64url')}`,
  })) as RevealedInfo;
}

export function bindSubmittedQuizMedia(revealed: RevealedInfo, attemptId: string, locale?: Locale): RevealedInfo {
  return mapMediaRefs(revealed, (assetId) => ({
    assetId, quizAttemptId: attemptId, ...(locale ? { quizMediaLocale: locale } : {}),
  })) as RevealedInfo;
}

/** Older saved results contain plain references. An attempt ID locates the server record and grants nothing by itself. */
export function restoreQuizMedia(value: unknown): unknown {
  const state = recordOf(value), last = recordOf(state?.last);
  if (last && typeof last.attemptId === 'string' && recordOf(last.revealed)) {
    return { ...state, last: { ...last, revealed: bindSubmittedQuizMedia(last.revealed as RevealedInfo, last.attemptId) } };
  }
  // A pre-receipt practice check has no trusted persisted record. Keep its answer available for a fresh check.
  const checks = recordOf(state?.checks);
  if (!checks) return state ?? value;
  return { ...state, checks: Object.fromEntries(Object.entries(checks).filter(([, check]) => {
    let needsCheck = false;
    mapMediaRefs(recordOf(check)?.revealed, () => { needsCheck = true; });
    return !needsCheck;
  })) };
}

export function checkedQuizMediaScope(proof: string, userId: string, assetId: string): { versionId: string; branchId: string | null } | null {
  const match = receipt.exec(proof);
  if (!match) return null;
  const [, versionId, branch, mac] = match;
  const branchId = branch || null;
  const actual = Buffer.from(mac, 'base64url');
  const expected = signature(userId, versionId, branchId, assetId);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? { versionId, branchId } : null;
}

export async function canReadCheckedQuizMedia(database: Database, actor: Actor, proof: string, assetId: string): Promise<boolean> {
  const scope = checkedQuizMediaScope(proof, actor.userId, assetId);
  if (!scope || !await hasMediaEnrollment(database, actor, scope.versionId)) return false;
  await assertEnrollmentMembershipAccess(actor, { branch_scope_known: true, branch_id: scope.branchId }, database as unknown as MembershipAccessDatabase);
  return true;
}

export function submittedQuizFeedback(grading: GradingItem, quiz: QuizGradingSettings & { questionIds: string[] }, locale: Locale, defaultLocale: Locale): RevealedInfo {
  const reveal = quiz.feedback === 'per_question' || quiz.feedback === 'after_submit';
  return buildRevealed(grading, quiz.questionIds, locale, defaultLocale, { answers: reveal, explanations: reveal && quiz.showExplanations });
}

export async function canReadSubmittedQuizMedia(database: Database, actor: Actor, attemptId: string, assetId: string, locale?: Locale): Promise<boolean> {
  const result = await database.from('quiz_attempts')
    .select('id,user_id,course_version_id,quiz_id,branch_id,branch_scope_known,course_version_items(kind,grading)')
    .eq('user_id', actor.userId).eq('id', attemptId).maybeSingle();
  if (result.error) throw new Error('Quiz media lookup failed');
  const attempt = recordOf(result.data), item = oneRecord(attempt?.course_version_items);
  if (attempt?.id !== attemptId || attempt.user_id !== actor.userId || typeof attempt.course_version_id !== 'string'
    || typeof attempt.quiz_id !== 'string' || item?.kind !== 'lesson' || !recordOf(item.grading)) return false;
  if (!await hasMediaEnrollment(database, actor, attempt.course_version_id)) return false;
  await assertEnrollmentMembershipAccess(actor, attempt, database as unknown as MembershipAccessDatabase);
  const grading = item.grading as GradingItem;
  const quiz = grading.quizzes?.[attempt.quiz_id];
  if (!quiz || !Array.isArray(quiz.questionIds)) return false;
  // Saved results predating localized links did not record the language used for feedback.
  return (locale ? [locale] : LOCALES).some((language) => referencesAsset(submittedQuizFeedback(grading, quiz, language, 'vi'), assetId));
}
