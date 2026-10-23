import 'server-only';

import { resolveL10nString, type L10nString, type Locale } from '@/content-engine';
import { listCertificateRecords, type CertificateDatabase } from '@/features/certificates/service';
import { loadBranchId } from '@/features/learning/shared';
import {
  createOpportunityService,
  type LocalizedOpportunity,
  type OpportunityContext,
  type OpportunityDatabase,
} from '@/features/opportunities/service';
import { createSubmissionsService, type SubmissionDatabase } from '@/features/submissions/service';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import { recordOf, recordsOf, type LearnerDatabase } from '@/features/learning/shared';
import { createXpService, type XpDatabase } from '@/features/xp/service';

export type LearnerRewards = {
  profile: {
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
    locale: Locale;
    profilePublic: boolean;
  };
  xpTotal: number;
  streak: { current: number; longest: number; lastActiveDate: string | null };
  certificates: Array<{
    id: string;
    courseId: string;
    courseTitle: string;
    serial: string;
    issuedAt: string;
    pdfAssetId: string | null;
    verificationCode: string;
  }>;
};

export type LearnerHomeSummary = {
  rewards: LearnerRewards;
  continueLearning: LearningTarget | null;
  nextRequired: LearningTarget | null;
  upcomingExam: (LearningTarget & { openAt: string | null; closeAt: string | null }) | null;
  feedback: LearnerFeedback | null;
  recommendedOpportunity: Pick<LocalizedOpportunity, 'id' | 'title' | 'organization' | 'type'> | null;
};

export type LearnerFeedback = LearningTarget & {
  decision: 'approved' | 'changes_requested';
  message: string;
  at: string;
};

export type LearnerHomeDependencies = {
  recommended(context: OpportunityContext): Promise<LocalizedOpportunity | undefined>;
  listSubmissions(actor: Actor, courseId: string, itemId: string): Promise<unknown[]>;
};

export type LearningTarget = {
  courseId: string;
  courseTitle: string;
  itemId: string;
  itemTitle: string;
  kind: 'lesson' | 'exam' | 'assignment';
};

function titleOf(value: unknown, locale: Locale, defaultLocale: Locale): string {
  if (typeof value === 'string') return value;
  const record = recordOf(value);
  return record ? resolveL10nString(record as L10nString, locale, defaultLocale) : '';
}

export async function readLearnerRewards(
  actor: Actor,
  locale: Locale,
  database: LearnerDatabase = supabaseService() as unknown as LearnerDatabase,
): Promise<LearnerRewards> {
  const xp = createXpService({ database: database as unknown as XpDatabase });
  const [profileResult, xpResult, certificates] = await Promise.all([
    database.from('profiles')
      .select('display_name,handle,avatar_url,locale,profile_public')
      .eq('id', actor.userId)
      .maybeSingle(),
    xp.summary(actor.userId),
    listCertificateRecords(database as unknown as Pick<CertificateDatabase, 'from'>, actor.userId),
  ]);

  const profile = profileResult.error ? null : recordOf(profileResult.data);
  const versionIds = certificates.map((row) => row.courseVersionId);
  const outlineResult = versionIds.length > 0
    ? await database.from('course_version_outline')
      .select('version_id,meta,default_language')
      .in('version_id', versionIds)
    : { data: [], error: null };
  const outlineByVersion = new Map(recordsOf(outlineResult.error ? [] : outlineResult.data).flatMap((row) => (
    typeof row.version_id === 'string' ? [[row.version_id, row] as const] : []
  )));

  return {
    profile: {
      displayName: typeof profile?.display_name === 'string' ? profile.display_name : '',
      handle: typeof profile?.handle === 'string' ? profile.handle : null,
      avatarUrl: typeof profile?.avatar_url === 'string' ? profile.avatar_url : null,
      locale: profile?.locale === 'en' ? 'en' : profile?.locale === 'vi' ? 'vi' : locale === 'en' ? 'en' : 'vi',
      profilePublic: profile?.profile_public === true,
    },
    xpTotal: xpResult.total,
    streak: xpResult.streak,
    certificates: certificates.map((certificate) => {
      const outline = outlineByVersion.get(certificate.courseVersionId);
      const meta = recordOf(outline?.meta);
      const defaultLocale: Locale = outline?.default_language === 'en' ? 'en' : 'vi';
      return {
        id: certificate.id,
        courseId: certificate.courseId,
        courseTitle: titleOf(meta?.title, locale, defaultLocale),
        serial: certificate.serial,
        issuedAt: certificate.issuedAt,
        pdfAssetId: certificate.pdfAssetId,
        verificationCode: certificate.verificationCode,
      };
    }),
  };
}

function localizedOutlineRow(row: Record<string, unknown>, locale: Locale) {
  const defaultLocale: Locale = row.default_language === 'en' ? 'en' : 'vi';
  const meta = recordOf(row.meta);
  const modules = recordOf(row.outline)?.modules;
  return {
    versionId: typeof row.version_id === 'string' ? row.version_id : '',
    courseId: typeof row.course_id === 'string' ? row.course_id : '',
    defaultLocale,
    courseTitle: titleOf(meta?.title, locale, defaultLocale),
    items: Array.isArray(modules) ? modules.flatMap((moduleValue) => {
      const items = recordOf(moduleValue)?.items;
      return Array.isArray(items) ? items.flatMap((itemValue) => {
        const item = recordOf(itemValue);
        return item
          && typeof item.id === 'string'
          && (item.type === 'lesson' || item.type === 'exam' || item.type === 'assignment')
          ? [{
            id: item.id,
            kind: item.type as LearningTarget['kind'],
            title: titleOf(item.title, locale, defaultLocale),
            required: item.required !== false,
          }]
          : [];
      }) : [];
    }) : [],
  };
}

function defaultHomeDependencies(database: LearnerDatabase): LearnerHomeDependencies {
  const opportunities = createOpportunityService({
    database: database as unknown as OpportunityDatabase,
    requirePermission: async () => { throw new Error('Learner summary cannot mutate opportunities'); },
  });
  const submissions = createSubmissionsService({ database: database as unknown as SubmissionDatabase });
  return {
    recommended: (context) => opportunities.recommended(context),
    listSubmissions: (actor, courseId, itemId) => submissions.listMine(actor, courseId, itemId),
  };
}

function releasedFeedback(
  targets: Array<LearningTarget & { versionId: string }>,
  histories: unknown[][],
  locale: Locale,
): LearnerFeedback | null {
  const candidates = targets.flatMap((target, index) => histories[index].flatMap((value) => {
    const submission = recordOf(value);
    if (!submission || submission.course_version_id !== target.versionId) return [];
    const grades = Array.isArray(submission.grades) ? recordsOf(submission.grades) : [recordOf(submission.grades)].filter(Boolean) as Record<string, unknown>[];
    return grades.flatMap((grade) => {
      if (grade.released !== true || (grade.decision !== 'approved' && grade.decision !== 'changes_requested')) return [];
      const message = titleOf(grade.feedback, locale, locale);
      const at = typeof grade.graded_at === 'string'
        ? grade.graded_at
        : typeof submission.submitted_at === 'string' ? submission.submitted_at : '';
      return message && at ? [{
        courseId: target.courseId,
        courseTitle: target.courseTitle,
        itemId: target.itemId,
        itemTitle: target.itemTitle,
        kind: target.kind,
        decision: grade.decision,
        message,
        at,
      } satisfies LearnerFeedback] : [];
    });
  }));
  return candidates.sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0] ?? null;
}

export async function readLearnerHome(
  actor: Actor,
  locale: Locale,
  database: LearnerDatabase = supabaseService() as unknown as LearnerDatabase,
  now = new Date(),
  dependencies: LearnerHomeDependencies = defaultHomeDependencies(database),
): Promise<LearnerHomeSummary> {
  const [rewards, enrollmentResult, branchId] = await Promise.all([
    readLearnerRewards(actor, locale, database),
    database.from('enrollments')
      .select('course_id,course_version_id,status,enrolled_at')
      .eq('user_id', actor.userId)
      .in('status', ['active', 'completed'])
      .order('enrolled_at', { ascending: false }),
    loadBranchId(database, actor.userId),
  ]);
  const enrollments = enrollmentResult.error ? [] : recordsOf(enrollmentResult.data).filter((row) => (
    typeof row.course_id === 'string'
      && typeof row.course_version_id === 'string'
      && (row.status === 'active' || row.status === 'completed')
  ));
  const versionIds = [...new Set(enrollments.map((row) => row.course_version_id as string))];
  if (versionIds.length === 0) {
    const recommended = await dependencies.recommended({ userId: actor.userId, branchId, locale, now });
    return {
      rewards,
      continueLearning: null,
      nextRequired: null,
      upcomingExam: null,
      feedback: null,
      recommendedOpportunity: recommended ?? null,
    };
  }

  const outlinesResult = await database.from('course_version_outline')
    .select('version_id,course_id,outline,meta,default_language')
    .in('version_id', versionIds);
  const outlinesByVersion = new Map((outlinesResult.error ? [] : recordsOf(outlinesResult.data))
    .map((row) => localizedOutlineRow(row, locale))
    .filter(({ versionId, courseId }) => versionId && courseId)
    .map((outline) => [outline.versionId, outline] as const));
  const outlines = enrollments.flatMap((enrollment) => {
    const outline = outlinesByVersion.get(enrollment.course_version_id as string);
    return outline ? [{ ...outline, enrollmentStatus: enrollment.status }] : [];
  });
  const allTargets = outlines.flatMap((outline) => outline.items.map((item): LearningTarget & { versionId: string; required: boolean; enrollmentStatus: unknown } => ({
    courseId: outline.courseId,
    courseTitle: outline.courseTitle,
    itemId: item.id,
    itemTitle: item.title,
    kind: item.kind,
    versionId: outline.versionId,
    required: item.required,
    enrollmentStatus: outline.enrollmentStatus,
  })));
  const targets = allTargets.filter((target) => target.enrollmentStatus === 'active');
  const activeVersionIds = [...new Set(targets.map((target) => target.versionId))];
  const examIds = [...new Set(targets.flatMap((target) => target.kind === 'exam' ? [target.itemId] : []))];
  const renderLocales = [...new Set<Locale>([locale, ...outlines.map((outline) => outline.defaultLocale)])];
  const emptyResult = { data: [], error: null };

  const [lessonsResult, examsResult, assignmentsResult, activityResult, rendersResult] = await Promise.all([
    activeVersionIds.length > 0 ? database.from('lesson_progress')
      .select('course_version_id,item_id,status,started_at,completed_at')
      .eq('user_id', actor.userId)
      .in('course_version_id', activeVersionIds) : Promise.resolve(emptyResult),
    activeVersionIds.length > 0 ? database.from('exam_grades')
      .select('course_version_id,item_id,passed')
      .eq('user_id', actor.userId)
      .in('course_version_id', activeVersionIds) : Promise.resolve(emptyResult),
    activeVersionIds.length > 0 ? database.from('assignment_submissions')
      .select('course_version_id,item_id,status,submitted_at,grades(decision,released)')
      .eq('user_id', actor.userId)
      .in('course_version_id', activeVersionIds)
      .order('submitted_at', { ascending: false }) : Promise.resolve(emptyResult),
    activeVersionIds.length > 0 ? database.from('activity_state')
      .select('course_version_id,item_id,updated_at')
      .eq('user_id', actor.userId)
      .in('course_version_id', activeVersionIds)
      .order('updated_at', { ascending: false })
      .limit(50) : Promise.resolve(emptyResult),
    examIds.length > 0
      ? database.from('course_version_item_renders')
        .select('version_id,item_id,locale,payload')
        .in('version_id', activeVersionIds)
        .in('item_id', examIds)
        .in('locale', renderLocales)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const lessons = lessonsResult.error ? [] : recordsOf(lessonsResult.data);
  const exams = examsResult.error ? [] : recordsOf(examsResult.data);
  const assignments = assignmentsResult.error ? [] : recordsOf(assignmentsResult.data);
  const complete = (target: (typeof targets)[number]) => {
    if (target.kind === 'lesson') return lessons.some((row) => row.course_version_id === target.versionId && row.item_id === target.itemId && row.status === 'completed');
    if (target.kind === 'exam') return exams.some((row) => row.course_version_id === target.versionId && row.item_id === target.itemId && row.passed === true)
      || lessons.some((row) => row.course_version_id === target.versionId && row.item_id === target.itemId && row.status === 'completed');
    return assignments.some((row) => row.course_version_id === target.versionId
      && row.item_id === target.itemId
      && recordsOf(row.grades).some((grade) => grade.released === true && grade.decision === 'approved'));
  };
  const strip = ({ versionId: _versionId, required: _required, enrollmentStatus: _enrollmentStatus, ...target }: (typeof targets)[number]): LearningTarget => target;
  const nextRequiredTarget = targets.find((target) => target.required && !complete(target));
  const recentTarget = (activityResult.error ? [] : recordsOf(activityResult.data)).reduce<(typeof targets)[number] | undefined>((found, activity) => (
    found ?? targets.find((target) => (
      target.versionId === activity.course_version_id
        && target.itemId === activity.item_id
        && !complete(target)
    ))
  ), undefined);

  const renderRows = rendersResult.error ? [] : recordsOf(rendersResult.data);
  const examWindows = targets.flatMap((target) => {
    if (target.kind !== 'exam') return [];
    const outline = outlinesByVersion.get(target.versionId);
    const row = renderRows.find((candidate) => (
      candidate.version_id === target.versionId
        && candidate.item_id === target.itemId
        && candidate.locale === locale
    )) ?? renderRows.find((candidate) => (
      candidate.version_id === target.versionId
        && candidate.item_id === target.itemId
        && candidate.locale === outline?.defaultLocale
    ));
    if (!row) return [];
    const payload = recordOf(row.payload);
    if (payload?.kind !== 'exam') return [];
    const availability = recordOf(recordOf(payload.settings)?.availability);
    const openAt = typeof availability?.openAt === 'string' ? availability.openAt : null;
    const closeAt = typeof availability?.closeAt === 'string' ? availability.closeAt : null;
    if (!openAt && !closeAt) return [];
    const closeTime = closeAt ? Date.parse(closeAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(closeTime) && closeTime <= now.getTime()) return [];
    return !complete(target) ? [{ ...strip(target), openAt, closeAt }] : [];
  }).sort((a, b) => Date.parse(a.openAt ?? a.closeAt ?? '') - Date.parse(b.openAt ?? b.closeAt ?? ''));

  const assignmentTargets = allTargets.filter((target) => target.kind === 'assignment');
  const [recommended, assignmentHistories] = await Promise.all([
    dependencies.recommended({ userId: actor.userId, branchId, locale, now }),
    Promise.all(assignmentTargets.map((target) => dependencies.listSubmissions(actor, target.courseId, target.itemId))),
  ]);

  return {
    rewards,
    continueLearning: recentTarget ? strip(recentTarget) : nextRequiredTarget ? strip(nextRequiredTarget) : null,
    nextRequired: nextRequiredTarget ? strip(nextRequiredTarget) : null,
    upcomingExam: examWindows[0] ?? null,
    feedback: releasedFeedback(assignmentTargets, assignmentHistories, locale),
    recommendedOpportunity: recommended ?? null,
  };
}

export async function readItemActivitySummary(
  actor: Actor,
  courseVersionId: string,
  itemId: string,
  database: LearnerDatabase = supabaseService() as unknown as LearnerDatabase,
): Promise<{ attemptsUsed: number; completionMode: 'view' | 'activities' | null }> {
  const [attemptsResult, gradingResult] = await Promise.all([
    database.from('exam_attempts')
      .select('id')
      .eq('user_id', actor.userId)
      .eq('course_version_id', courseVersionId)
      .eq('item_id', itemId),
    database.from('course_version_items')
      .select('grading')
      .eq('version_id', courseVersionId)
      .eq('item_id', itemId)
      .maybeSingle(),
  ]);
  const grading = gradingResult.error ? null : recordOf(recordOf(gradingResult.data)?.grading);
  return {
    attemptsUsed: attemptsResult.error ? 0 : recordsOf(attemptsResult.data).length,
    completionMode: grading?.lessonCompletionMode === 'activities'
      ? 'activities'
      : grading?.lessonCompletionMode === 'view' ? 'view' : null,
  };
}
