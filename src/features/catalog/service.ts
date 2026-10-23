import 'server-only';

import {
  evaluateCompletion,
  resolveL10nString,
  type L10nString,
  type Locale,
  type MediaRef,
} from '@/content-engine';
import { ApiError } from '@/lib/api';
import { isInternalContentId, internalContentPolicy } from '@/lib/internal-content';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import {
  branchCanAccess,
  completionRules,
  databaseFailure,
  itemIsComplete,
  loadBranchId,
  loadCompletionRows,
  outlineItems,
  recordOf,
  recordsOf,
  type LearnerDatabase,
} from '@/features/learning/shared';
import { assertEnrollmentMembershipAccess } from '@/features/learning/membership-access';

export type CatalogFilters = {
  level?: 'foundation' | 'specialization';
  pathway?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  language?: Locale;
};

const CATALOG_SELECT = `
  version_id,
  course_id,
  outline,
  meta,
  access,
  completion,
  skills,
  languages,
  default_language
`;

function localized(value: unknown, locale: Locale, defaultLocale: Locale): string {
  if (typeof value === 'string') return value;
  const map = recordOf(value);
  return map ? resolveL10nString(map as L10nString, locale, defaultLocale) : '';
}

function localeOf(row: Record<string, unknown>): Locale {
  return row.default_language === 'en' ? 'en' : 'vi';
}

function filterMatches(row: Record<string, unknown>, filters: CatalogFilters): boolean {
  const meta = recordOf(row.meta);
  if (!meta) return false;
  if (filters.level && meta.level !== filters.level) return false;
  if (filters.pathway && meta.pathway !== filters.pathway) return false;
  if (filters.difficulty && meta.difficulty !== filters.difficulty) return false;
  return !filters.language || (Array.isArray(row.languages) && row.languages.includes(filters.language));
}

function localizedSkills(value: unknown, locale: Locale, defaultLocale: Locale) {
  return recordsOf(value).flatMap((skill) => typeof skill.id === 'string'
    ? [{ id: skill.id, name: localized(skill.name, locale, defaultLocale) }]
    : []);
}

function localizedMeta(value: unknown, locale: Locale, defaultLocale: Locale) {
  const meta = recordOf(value) ?? {};
  const cover = recordOf(meta.cover) as MediaRef | null;
  return {
    title: localized(meta.title, locale, defaultLocale),
    summary: localized(meta.summary, locale, defaultLocale),
    level: typeof meta.level === 'string' ? meta.level : 'foundation',
    difficulty: typeof meta.difficulty === 'string' ? meta.difficulty : 'beginner',
    pathway: typeof meta.pathway === 'string' ? meta.pathway : 'core-future-skills',
    tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    learningOutcomes: Array.isArray(meta.learningOutcomes)
      ? meta.learningOutcomes.map((outcome) => localized(outcome, locale, defaultLocale))
      : [],
    ...(typeof meta.estimatedMinutes === 'number' ? { estimatedMinutes: meta.estimatedMinutes } : {}),
    ...(cover ? { cover } : {}),
    ...(typeof meta.code === 'string' && meta.code ? { code: meta.code } : {}),
    ...(Array.isArray(meta.prerequisites) && meta.prerequisites.every((id) => typeof id === 'string') && meta.prerequisites.length ? { prerequisites: meta.prerequisites as string[] } : {}),
  };
}

function localizedOutline(value: unknown, locale: Locale, defaultLocale: Locale, statuses: Record<string, string>) {
  const modules = recordOf(value)?.modules;
  return {
    modules: Array.isArray(modules) ? modules.flatMap((moduleValue) => {
      const courseModule = recordOf(moduleValue);
      if (!courseModule || typeof courseModule.id !== 'string') return [];
      const items = Array.isArray(courseModule.items) ? courseModule.items.flatMap((itemValue) => {
        const item = recordOf(itemValue);
        if (!item || typeof item.id !== 'string' || !['lesson', 'exam', 'assignment'].includes(String(item.type))) return [];
        return [{
          id: item.id,
          type: item.type,
          title: localized(item.title, locale, defaultLocale),
          required: item.required !== false,
          status: statuses[item.id] ?? 'not_started',
          ...(typeof item.estimatedMinutes === 'number' ? { estimatedMinutes: item.estimatedMinutes } : {}),
        }];
      }) : [];
      return [{ id: courseModule.id, title: localized(courseModule.title, locale, defaultLocale), items }];
    }) : [],
  };
}

export async function listCatalog(actor: Actor, locale: Locale, filters: CatalogFilters = {}) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const branchId = await loadBranchId(database, actor.userId);
  const courseResult = await database.from('courses')
    .select('id,slug,status,current_version_id')
    .eq('status', 'published')
    .order('id', { ascending: true });
  databaseFailure(courseResult.error, 'Catalog courses could not be loaded');
  const courses = recordsOf(courseResult.data).filter((course) => (
    typeof course.id === 'string' && typeof course.current_version_id === 'string'
  ));
  if (courses.length === 0) return [];
  const courseByVersion = new Map(courses.map((course) => [course.current_version_id as string, course]));
  let query = database.from('course_version_outline')
    .select(CATALOG_SELECT)
    .in('version_id', [...courseByVersion.keys()]);
  query = branchId
    ? query.or(`access->>scope.eq.global,and(access->>scope.eq.branches,access->branchIds.cs.${JSON.stringify([branchId])})`)
    : query.eq('access->>scope', 'global');
  if (filters.level) query = query.eq('meta->>level', filters.level);
  if (filters.pathway) query = query.eq('meta->>pathway', filters.pathway);
  if (filters.difficulty) query = query.eq('meta->>difficulty', filters.difficulty);
  if (filters.language) query = query.contains('languages', [filters.language]);
  const { data, error } = await query.order('course_id', { ascending: true });
  databaseFailure(error, 'Catalog could not be loaded');

  const enrollmentResult = await database.from('enrollments')
    .select('course_id,course_version_id,status')
    .eq('user_id', actor.userId)
    .in('course_id', courses.map((course) => course.id as string));
  databaseFailure(enrollmentResult.error, 'Catalog enrollments could not be loaded');
  const enrollmentByCourse = new Map(recordsOf(enrollmentResult.data).flatMap((row) => (
    typeof row.course_id === 'string'
      && typeof row.course_version_id === 'string'
      && (row.status === 'active' || row.status === 'completed')
      ? [[row.course_id, { status: row.status, courseVersionId: row.course_version_id }] as const]
      : []
  )));

  const internal = internalContentPolicy();
  return recordsOf(data).flatMap((row) => {
    const course = typeof row.version_id === 'string' ? courseByVersion.get(row.version_id) : undefined;
    if (!course || typeof course.id !== 'string' || row.course_id !== course.id) return [];
    if (!branchCanAccess(row.access, branchId) || !filterMatches(row, filters)) return [];
    // Hidden fixtures stay listed for learners already enrolled, so their dashboard keeps them.
    if (isInternalContentId(course.id, internal) && !enrollmentByCourse.has(course.id)) return [];
    const defaultLocale = localeOf(row);
    const meta = localizedMeta(row.meta, locale, defaultLocale);
    return [{
      id: course.id,
      slug: typeof course.slug === 'string' ? course.slug : course.id,
      versionId: row.version_id,
      ...meta,
      languages: Array.isArray(row.languages) ? row.languages : [],
      skills: localizedSkills(row.skills, locale, defaultLocale),
      enrollment: enrollmentByCourse.get(course.id) ?? null,
    }];
  });
}

export async function getCourse(actor: Actor, courseId: string, locale: Locale) {
  const database = supabaseService() as unknown as LearnerDatabase;
  const courseResult = await database.from('courses')
    .select('id,slug,status,current_version_id')
    .eq('id', courseId)
    .maybeSingle();
  databaseFailure(courseResult.error, 'Course could not be loaded');
  const course = recordOf(courseResult.data);
  if (!course || course.status !== 'published' || typeof course.current_version_id !== 'string') {
    throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');
  }

  const enrollmentResult = await database.from('enrollments')
    .select('id,course_version_id,status,enrolled_at,completed_at,branch_id,branch_scope_known')
    .eq('user_id', actor.userId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(enrollmentResult.error, 'Enrollment could not be loaded');
  const enrollmentCandidate = recordOf(enrollmentResult.data);
  const enrollment = enrollmentCandidate
    && typeof enrollmentCandidate.course_version_id === 'string'
    && ['active', 'completed'].includes(String(enrollmentCandidate.status))
    ? enrollmentCandidate
    : null;
  if(enrollment)await assertEnrollmentMembershipAccess(actor,enrollment,database);
  const versionId = enrollment
    ? enrollment.course_version_id as string
    : course.current_version_id;

  const outlineResult = await database.from('course_version_outline')
    .select('version_id,course_id,outline,meta,access,completion,skills,languages,default_language')
    .eq('version_id', versionId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(outlineResult.error, enrollment ? 'Pinned course outline could not be loaded' : 'Course outline could not be loaded');
  const row = recordOf(outlineResult.data);
  if (!row) {
    throw new ApiError(404, 'COURSE_NOT_FOUND', enrollment ? 'Pinned course version was not found' : 'Course was not found');
  }
  if (!enrollment) {
    const branchId = await loadBranchId(database, actor.userId);
    if (!branchCanAccess(row.access, branchId)) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course was not found');
  }

  const items = outlineItems(row.outline);
  const { facts, lessonProgress } = await loadCompletionRows(database, actor.userId, versionId, items);
  const completionResult = evaluateCompletion(completionRules(row.completion), facts);
  const completionRowResult = await database.from('course_completions')
    .select('completed_at')
    .eq('user_id', actor.userId)
    .eq('course_id', courseId)
    .maybeSingle();
  databaseFailure(completionRowResult.error, 'Course completion could not be loaded');
  const recordedCompletion = recordOf(completionRowResult.data);
  const statuses = Object.fromEntries(items.map((item) => [
    item.id,
    itemIsComplete(item, facts)
      ? 'completed'
      : item.type === 'lesson' ? lessonProgress[item.id] ?? 'not_started' : 'not_started',
  ]));
  const defaultLocale = localeOf(row);
  const completedItems = items.filter((item) => itemIsComplete(item, facts)).length;

  return {
    id: courseId,
    slug: typeof course.slug === 'string' ? course.slug : courseId,
    versionId,
    meta: localizedMeta(row.meta, locale, defaultLocale),
    outline: localizedOutline(row.outline, locale, defaultLocale, statuses),
    skills: localizedSkills(row.skills, locale, defaultLocale),
    enrollment: enrollment ? {
      id: enrollment.id,
      status: enrollment.status,
      enrolledAt: enrollment.enrolled_at,
      completedAt: enrollment.completed_at ?? null,
    } : null,
    progress: { completedItems, totalItems: items.length, items: statuses },
    completion: {
      ...completionResult,
      complete: completionResult.complete || recordedCompletion !== null,
      certificate: recordOf(row.completion)?.certificate === true,
      completedAt: recordedCompletion?.completed_at ?? null,
    },
  };
}
